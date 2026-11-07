// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockSockets } from "../api/testing/MockSocket";
import { SyncController, socketUrl, type SyncOptions } from "./controller";
import { createSyncRig, type SyncRig, type TestDevice } from "./testing/rig";

const FAST: NonNullable<SyncOptions["delays"]> = { debounceMs: 10, pollMs: 10_000, retryMs: [20, 80], socketMs: [20, 80] };
const controllers: SyncController[] = [];
afterEach(() => {
  while (controllers.length) controllers.pop()!.stop();
});

/** Tabs share one lock: the first to ask holds it until it stops. */
function sharedLock() {
  let tail: Promise<unknown> = Promise.resolve();
  return (hold: () => Promise<void>) => {
    const run = tail.then(hold);
    tail = run.catch(() => undefined);
    return run;
  };
}

function controllerFor(r: SyncRig, d: TestDevice, options: Partial<SyncOptions> = {}) {
  const sockets = mockSockets(r.engine);
  const c = new SyncController(d.services, d.store, { socket: sockets.factory, lock: sharedLock(), baseUrl: "https://engine.test", delays: FAST, online: () => !r.network.down, ...options });
  controllers.push(c);
  return { c, sockets };
}

async function until(check: () => boolean, ms = 4000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out waiting");
    await new Promise((res) => setTimeout(res, 5));
  }
}

describe("the live socket", () => {
  it("opens wss with the token as the first message, and a notice makes the other device fetch", async () => {
    const r = await createSyncRig();
    const a = controllerFor(r, r.a);
    const b = controllerFor(r, r.b);
    a.c.start();
    b.c.start();
    await until(() => a.c.getState().live && b.c.getState().live && a.c.getState().phase === "idle" && b.c.getState().phase === "idle");
    expect(a.sockets.urls).toEqual(["wss://engine.test/v1/sync"]);
    // A new list made on B shows on A without anyone asking.
    const list = r.b.store.addList("From B", "c3");
    await until(() => r.a.store.getState().lists.some((l) => l.id === list.id));
    expect(r.a.store.getState().outbox).toEqual([]);
    expect(socketUrl("http://localhost:8080/")).toBe("ws://localhost:8080/v1/sync");
  });

  it("reconnects with backoff after the server closes it, and a resync makes a full pass", async () => {
    const r = await createSyncRig();
    const a = controllerFor(r, r.a);
    a.c.start();
    await until(() => a.c.getState().live);
    [...a.sockets.open][0]!.closeFromServer();
    await until(() => !a.c.getState().live);
    await until(() => a.c.getState().live); // a new socket, authenticated again
    expect(a.sockets.urls.length).toBe(2);
    // Something changed while it was down: the resync is the signal to look.
    r.b.store.addTask({ title: "Missed notice" });
    await new Promise((res) => setTimeout(res, 30));
    const { runCycle } = await import("./cycle");
    await runCycle(r.b.services, r.b.session, r.b.store);
    [...a.sockets.open][0]!.resync();
    await until(() => r.a.store.getState().tasks.some((t) => t.title === "Missed notice"));
  });

  it("only one tab holds the sync; the next takes over when it stops", async () => {
    const r = await createSyncRig();
    const lock = sharedLock();
    const first = controllerFor(r, r.a, { lock });
    const second = controllerFor(r, r.a, { lock });
    first.c.start();
    second.c.start();
    await until(() => first.c.getState().leader);
    expect(second.c.getState().leader).toBe(false);
    expect(second.sockets.urls).toEqual([]); // the follower never opens a socket
    first.c.stop();
    await until(() => second.c.getState().leader && second.c.getState().live);
    expect(first.sockets.open.size).toBe(0);
  });
});

describe("offline and online", () => {
  it("says offline with changes waiting, then synced with the device count once the network is back", async () => {
    const r = await createSyncRig();
    const a = controllerFor(r, r.a, { online: () => true }); // the browser thinks it is online; the requests fail
    a.c.start();
    await until(() => a.c.getState().phase === "idle" && a.c.getState().lastSyncedAt !== null);
    expect(a.c.getState().devices).toBe(2);
    r.network.down = true;
    r.a.store.addTask({ title: "Offline task" });
    await until(() => a.c.getState().phase === "offline");
    expect(r.a.store.getState().outbox.length).toBeGreaterThan(0); // saved here, waiting
    r.network.down = false;
    await until(() => a.c.getState().phase === "idle" && r.a.store.getState().outbox.length === 0); // it retried by itself
    expect(a.c.getState().error).toBeNull();
    const b = controllerFor(r, r.b);
    b.c.start();
    await until(() => r.b.store.getState().tasks.some((t) => t.title === "Offline task"));
  });

  it("goes offline at once when the browser says so, and picks up again on a pass after it is back", async () => {
    const r = await createSyncRig();
    const a = controllerFor(r, r.a);
    a.c.start();
    await until(() => a.c.getState().phase === "idle" && a.c.getState().lastSyncedAt !== null);
    const posts = () => r.engine.calls.filter((c) => c.method === "POST" && c.path.endsWith("/changes")).length;
    const before = posts();
    r.network.down = true;
    r.a.store.addTask({ title: "Written on a plane" });
    await until(() => a.c.getState().phase === "offline");
    expect(posts()).toBe(before); // nothing was even tried
    r.network.down = false;
    a.c.syncNow();
    await until(() => a.c.getState().phase === "idle" && r.a.store.getState().outbox.length === 0);
  });

  it("stops with a reason when a failure won't pass with waiting", async () => {
    const r = await createSyncRig();
    const { runCycle } = await import("./cycle");
    r.b.store.addTask({ title: "Changed on B" });
    await runCycle(r.b.services, r.b.session, r.b.store);
    const real = r.engine.fetch;
    r.engine.fetch = (async (url: string, init?: RequestInit) => {
      if (String(url).includes("/changes?") && (init?.method ?? "GET") === "GET") {
        return new Response(JSON.stringify({ code: "token_expired", message: "Too old." }), { status: 410, headers: { "content-type": "application/json" } });
      }
      return real(url, init);
    }) as typeof fetch;
    const a = controllerFor(r, r.a);
    a.c.start();
    await until(() => a.c.getState().phase === "error");
    expect(a.c.getState().error).toMatch(/keeps refusing/);
  });
});

describe("a tab that holds its account in memory only", () => {
  afterEach(() => vi.unstubAllGlobals());

  /** Another planner tab holds the sync lock, and every BroadcastChannel made or posted to is counted. */
  function sharedWorld() {
    // The sync lock is never granted (another tab holds it); the engine's own lock is granted at once.
    const request = vi.fn((name: string, hold: () => Promise<unknown>) => (name === "orbyn-planner-sync" ? new Promise<void>(() => undefined) : hold()));
    vi.stubGlobal("navigator", { onLine: true, locks: { request } });
    const made: string[] = [];
    const posted: unknown[] = [];
    vi.stubGlobal(
      "BroadcastChannel",
      class {
        onmessage: unknown = null;
        constructor(name: string) {
          made.push(name);
        }
        postMessage(data: unknown) {
          posted.push(data);
        }
        close() {}
      },
    );
    return { request, made, posted };
  }

  it("does not wait for the global sync lock, so it still leads and sends its keys", async () => {
    const r = await createSyncRig();
    const world = sharedWorld();
    r.a.services.keys.holdInMemory();
    const sockets = mockSockets(r.engine);
    const c = new SyncController(r.a.services, r.a.store, { socket: sockets.factory, baseUrl: "https://engine.test", delays: FAST, online: () => true });
    controllers.push(c);
    c.start();
    await until(() => c.getState().leader && c.getState().live);
    expect(world.request.mock.calls.filter(([name]) => name === "orbyn-planner-sync")).toEqual([]);
  });

  it("does not post its status, with the device names, to the other tabs, and does not listen to them", async () => {
    const r = await createSyncRig();
    const world = sharedWorld();
    r.a.services.keys.holdInMemory();
    const sockets = mockSockets(r.engine);
    const c = new SyncController(r.a.services, r.a.store, { socket: sockets.factory, baseUrl: "https://engine.test", delays: FAST, online: () => true });
    controllers.push(c);
    c.start();
    await until(() => c.getState().leader && c.getState().live);
    expect(world.made).toEqual([]);
    expect(world.posted).toEqual([]); // the controller reported (it led, it synced) and said nothing to other tabs
  });

  it("an account kept in storage still competes for the lock and posts its status (the control)", async () => {
    const r = await createSyncRig();
    const world = sharedWorld();
    const sockets = mockSockets(r.engine);
    const c = new SyncController(r.a.services, r.a.store, { socket: sockets.factory, baseUrl: "https://engine.test", delays: FAST, online: () => true });
    controllers.push(c);
    c.start();
    await until(() => world.request.mock.calls.some(([name]) => name === "orbyn-planner-sync"));
    expect(world.made).toContain("orbyn-planner-sync-status");
  });
});
