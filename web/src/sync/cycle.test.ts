// @vitest-environment node
//
// Sync through the engine's real module against the mock record store: two paired devices, their stores
// in memory, a server that versions records and refuses stale writes like the real one.
import { describe, expect, it } from "vitest";
import { runCycle } from "./cycle";
import { createSyncRig, type SyncRig, type TestDevice } from "./testing/rig";

const sync = (_r: SyncRig, d: TestDevice) => runCycle(d.services, d.session, d.store);
const titles = (d: TestDevice) => d.store.getState().tasks.map((t) => t.title).sort();

describe("outgoing and incoming", () => {
  it("a task made on A reaches B, and A's outbox is cleared only once it was acknowledged", async () => {
    const r = await createSyncRig();
    r.a.store.addTask({ title: "Buy milk" });
    expect(r.a.store.getState().outbox.length).toBeGreaterThan(0);
    const report = await sync(r, r.a);
    expect(report.uploaded).toBeGreaterThan(0);
    expect(r.a.store.getState().outbox).toEqual([]);
    await sync(r, r.b);
    expect(titles(r.b)).toEqual(["Buy milk"]);
    // What arrived is not an edit of B's: nothing to send back.
    expect(r.b.store.getState().outbox).toEqual([]);
    // The server holds only ciphertext.
    const zone = [...[...r.engine.accounts.values()][0]!.records!.zones.values()].find((z) => z.name.startsWith("list:"))!;
    const stored = [...zone.records.values()].find((x) => x.record_type === "task")!;
    expect(stored.ciphertext).toBeTruthy();
    expect(JSON.stringify(stored)).not.toContain("Buy milk");
  });

  it("zones are one per list, project and calendar, named by kind and id", async () => {
    const r = await createSyncRig();
    const list = r.a.store.addList("Home", "c2");
    r.a.store.addTask({ title: "Mow", listId: list.id });
    const project = r.a.store.addProject({ name: "House", colour: "c3" });
    await sync(r, r.a);
    const names = [...[...r.engine.accounts.values()][0]!.records!.zones.keys()].sort();
    expect(names).toContain(`list:${list.id}`);
    expect(names).toContain(`project:${project.id}`);
    expect(names.some((n) => n.startsWith("calendar:"))).toBe(true);
    expect(names).toContain("list:inbox");
  });

  it("a list made on B shows on A with its tasks, and the keys came through the keychain", async () => {
    const r = await createSyncRig();
    const list = r.b.store.addList("Trip", "c3");
    r.b.store.addTask({ title: "Passport", listId: list.id });
    await sync(r, r.b);
    await sync(r, r.a);
    expect(r.a.store.getState().lists.map((l) => l.name)).toContain("Trip");
    expect(titles(r.a)).toContain("Passport");
  });

  it("both edit offline and converge: different fields keep both, the same field keeps the later", async () => {
    const r = await createSyncRig();
    const task = r.a.store.addTask({ title: "Plan", notes: "" });
    await sync(r, r.a);
    await sync(r, r.b);
    r.clock.now += 1000;
    r.a.store.updateTask(task.id, { notes: "from A" });
    r.clock.now += 1000;
    r.b.store.updateTask(task.id, { priority: "high", title: "Plan it" });
    r.clock.now += 1000;
    r.a.store.updateTask(task.id, { title: "Plan it properly" }); // the latest edit of the title
    await sync(r, r.a);
    await sync(r, r.b);
    await sync(r, r.a);
    for (const [name, d] of [["A", r.a], ["B", r.b]] as const) {
      const t = d.store.getState().tasks.find((x) => x.id === task.id)!;
      expect({ name, title: t.title, notes: t.notes, priority: t.priority }).toEqual({ name, title: "Plan it properly", notes: "from A", priority: "high" });
    }
    expect(r.a.store.getState().outbox).toEqual([]);
    expect(r.b.store.getState().outbox).toEqual([]);
  });

  it("an edit made while an upload was out is not lost", async () => {
    const r = await createSyncRig();
    const task = r.a.store.addTask({ title: "One" });
    await sync(r, r.a);
    r.a.store.updateTask(task.id, { title: "Two" });
    const during = sync(r, r.a);
    r.a.store.updateTask(task.id, { title: "Three" }); // before the cycle reaches the acknowledgement
    await during;
    await sync(r, r.a);
    await sync(r, r.b);
    expect(r.b.store.getState().tasks.find((x) => x.id === task.id)?.title).toBe("Three");
  });

  it("a hard delete is a signed delete that removes the record on the other device", async () => {
    const r = await createSyncRig();
    const task = r.a.store.addTask({ title: "Doomed" });
    await sync(r, r.a);
    await sync(r, r.b);
    expect(titles(r.b)).toEqual(["Doomed"]);
    // The purge after 30 days, as the store makes it.
    await r.a.persistence.apply({ at: new Date(r.clock.now).toISOString(), patches: [{ type: "task", id: task.id, op: "purge", key: "k" }] });
    r.a.store = await r.reload(r.a);
    await sync(r, r.a);
    await sync(r, r.b);
    expect(titles(r.b)).toEqual([]);
  });

  it("a soft delete is an ordinary edit and travels as one", async () => {
    const r = await createSyncRig();
    const task = r.a.store.addTask({ title: "Soft" });
    await sync(r, r.a);
    await sync(r, r.b);
    r.clock.now += 1000;
    r.a.store.deleteTask(task.id);
    await sync(r, r.a);
    await sync(r, r.b);
    expect(r.b.store.getState().tasks.find((x) => x.id === task.id)?.deletedAt).not.toBeNull();
  });

  it("a task moved to another list moves zones", async () => {
    const r = await createSyncRig();
    const home = r.a.store.addList("Home", "c2");
    const task = r.a.store.addTask({ title: "Move me" });
    await sync(r, r.a);
    await sync(r, r.b);
    r.clock.now += 1000;
    r.a.store.updateTask(task.id, { listId: home.id });
    await sync(r, r.a);
    await sync(r, r.b);
    const moved = r.b.store.getState().tasks.find((x) => x.id === task.id)!;
    expect(moved.listId).toBe(home.id);
    expect(r.b.store.getState().tasks.filter((x) => x.id === task.id)).toHaveLength(1);
  });
});

describe("offline and failures", () => {
  it("nothing is lost while the network is down, and the next cycle sends it", async () => {
    const r = await createSyncRig();
    r.a.store.addTask({ title: "Written offline" });
    r.network.down = true;
    await expect(sync(r, r.a)).rejects.toThrow();
    expect(r.a.store.getState().outbox.length).toBeGreaterThan(0);
    r.network.down = false;
    await sync(r, r.a);
    expect(r.a.store.getState().outbox).toEqual([]);
    await sync(r, r.b);
    expect(titles(r.b)).toEqual(["Written offline"]);
  });

  it("a lost answer replays instead of writing twice", async () => {
    const r = await createSyncRig();
    r.a.store.addTask({ title: "Once" });
    r.network.loseAnswer = true; // the first upload reaches the server; the answer doesn't come back
    await expect(sync(r, r.a)).rejects.toThrow();
    expect(r.a.store.getState().outbox.length).toBeGreaterThan(0); // not cleared: it was never acknowledged
    await sync(r, r.a); // the same batch, the same operation id: the server answers from its record of it
    expect(r.a.store.getState().outbox).toEqual([]);
    const zone = [...[...r.engine.accounts.values()][0]!.records!.zones.values()].find((z) => z.name === "list:inbox")!;
    expect(zone.operations.size).toBeGreaterThan(0);
    await sync(r, r.b);
    expect(titles(r.b)).toEqual(["Once"]);
    const task = [...zone.records.values()].find((x) => x.record_type === "task")!;
    expect(task.version).toBeGreaterThan(0);
  });

  it("an expired change token starts the zone over: it is fetched again from the start and nothing is lost or re-sent", async () => {
    const r = await createSyncRig();
    r.a.store.addTask({ title: "x" });
    await sync(r, r.a);
    await sync(r, r.b);
    r.a.store.addTask({ title: "new on A" });
    await sync(r, r.a);
    // The server refuses B's token once, as it would after the zone was purged past it.
    const real = r.engine.fetch;
    let refused = 0;
    let expired = 0;
    const asked: string[] = [];
    r.engine.fetch = (async (url: string, init?: RequestInit) => {
      if (/\/changes(\?|$)/.test(String(url)) && (init?.method ?? "GET") === "GET") {
        asked.push(String(url));
        if (String(url).includes("since=") && refused++ === 0) {
          expired++;
          return new Response(JSON.stringify({ code: "token_expired", message: "Too old." }), { status: 410, headers: { "content-type": "application/json" } });
        }
      }
      return real(url, init);
    }) as typeof fetch;
    r.b.store.addTask({ title: "unsent on B" });
    await sync(r, r.b);
    expect(expired).toBe(1);
    expect(asked.some((u) => !u.includes("since="))).toBe(true); // fetched again from the start
    expect(titles(r.b)).toEqual(["new on A", "unsent on B", "x"]);
    r.engine.fetch = real;
    await sync(r, r.a);
    expect(titles(r.a)).toEqual(["new on A", "unsent on B", "x"]);
    expect(r.b.store.getState().outbox).toEqual([]);
  });
});

describe("an upload refused for an expired token", () => {
  it("starts the zone over and sends the edit on the next pass, once", async () => {
    const r = await createSyncRig();
    r.a.store.addTask({ title: "Seed" });
    await sync(r, r.a);
    await sync(r, r.b);
    r.a.store.addTask({ title: "Edited once the token expired" });
    const real = r.engine.fetch;
    let refused = 0;
    r.engine.fetch = (async (url: string, init?: RequestInit) => {
      if (init?.method === "POST" && /\/v1\/zones\/[^/]+\/changes$/.test(String(url)) && refused++ === 0) {
        return new Response(JSON.stringify({ code: "token_expired", message: "Too old." }), { status: 410, headers: { "content-type": "application/json" } });
      }
      return real(url, init);
    }) as typeof fetch;
    await sync(r, r.a);
    await sync(r, r.a);
    await sync(r, r.b);
    expect(titles(r.b)).toEqual(["Edited once the token expired", "Seed"]);
    expect(r.a.store.getState().outbox).toEqual([]);
  });
});

describe("a refetch after an expired token doesn't trash this device's own unsent changes", () => {
  const trashOf = (d: TestDevice, zone: string) => d.services.engine.run(d.session, (e) => Object.keys(JSON.parse(e.sync!.trash(zone)) as Record<string, unknown>));

  it("an unsent create whose upload was refused for an expired token is re-staged, reaches B and isn't trashed", async () => {
    const r = await createSyncRig();
    r.a.store.addTask({ title: "Seed" });
    await sync(r, r.a);
    await sync(r, r.b);
    const created = r.a.store.addTask({ title: "Created, upload refused" });
    const real = r.engine.fetch;
    let refused = 0;
    r.engine.fetch = (async (url: string, init?: RequestInit) => {
      if (init?.method === "POST" && /\/v1\/zones\/[^/]+\/changes$/.test(String(url)) && refused++ === 0) {
        return new Response(JSON.stringify({ code: "token_expired", message: "Too old." }), { status: 410, headers: { "content-type": "application/json" } });
      }
      return real(url, init);
    }) as typeof fetch;
    await sync(r, r.a); // abandonUpload, tokenExpired: the zone is fetched again from the start next
    await sync(r, r.a);
    await sync(r, r.b);
    expect(titles(r.b)).toEqual(["Created, upload refused", "Seed"]);
    expect(titles(r.a)).toContain("Created, upload refused");
    expect(await trashOf(r.a, "list:inbox")).not.toContain(created.id);
    expect(r.a.store.getState().outbox).toEqual([]);
  });

  it("an unsent edit of a record the full listing no longer has is taken back out of the trash, made whole again and sent", async () => {
    const r = await createSyncRig({ third: true });
    const task = r.a.store.addTask({ title: "Held", notes: "original notes" });
    await sync(r, r.a);
    await sync(r, r.b);
    r.b.store.addTask({ title: "From B so A fetches" });
    await sync(r, r.b);
    await sync(r, r.a);
    r.clock.now += 1000;
    r.a.store.updateTask(task.id, { title: "Held, edited offline" });
    // The server purged the record (and the tombstone), and refuses the token this device holds.
    const account = [...r.engine.accounts.values()][0]!;
    const zone = account.records!.zones.get("list:inbox")!;
    zone.records.delete(task.id);
    zone.changedAt.delete(task.id);
    zone.sequence += 1;
    const real = r.engine.fetch;
    let expired = 0;
    r.engine.fetch = (async (url: string, init?: RequestInit) => {
      if (/\/changes(\?|$)/.test(String(url)) && (init?.method ?? "GET") === "GET" && String(url).includes("since=") && expired++ === 0) {
        return new Response(JSON.stringify({ code: "token_expired", message: "Too old." }), { status: 410, headers: { "content-type": "application/json" } });
      }
      return real(url, init);
    }) as typeof fetch;
    await sync(r, r.a);
    await sync(r, r.a);
    expect(titles(r.a)).toContain("Held, edited offline"); // still on screen
    expect(await trashOf(r.a, "list:inbox")).not.toContain(task.id);
    expect(r.a.store.getState().outbox).toEqual([]);
    await sync(r, r.c); // a device that never held the record sees exactly what was sent: the whole record
    const onC = r.c.store.getState().tasks.find((t) => t.id === task.id);
    expect({ title: onC?.title, notes: onC?.notes }).toEqual({ title: "Held, edited offline", notes: "original notes" });
  });
});

describe("keys and the quarantine", () => {
  it("records in a zone whose key hasn't arrived wait in the quarantine, and open when it does", async () => {
    const r = await createSyncRig();
    r.a.store.addTask({ title: "Secret plans" });
    await sync(r, r.a); // A makes the zones and sends the keys to B... which B hasn't taken yet
    // B fetches before reading its envelopes: stop the keychain from answering.
    const real = r.engine.fetch;
    let hide = true;
    r.engine.fetch = (async (url: string, init?: RequestInit) => {
      if (hide && String(url).includes("/v1/keychain/envelopes") && (init?.method ?? "GET") === "GET") {
        return new Response(JSON.stringify({ envelopes: [] }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return real(url, init);
    }) as typeof fetch;
    const first = await sync(r, r.b);
    expect(first.quarantined).toBeGreaterThan(0);
    expect(titles(r.b)).toEqual([]);
    hide = false;
    const second = await sync(r, r.b);
    expect(second.quarantined).toBe(0);
    expect(titles(r.b)).toEqual(["Secret plans"]);
  });
});
