// @vitest-environment node
//
// Record sync end to end against a running engine, with the real module: two paired devices, their stores in
// memory, the live socket. It runs only when ORBYN_E2E_ENGINE is set (see docs/architecture.md).
import { describe, expect, it } from "vitest";
import { SyncController } from "../sync/controller";
import { LocalStore } from "../store/LocalStore";
import { MemoryPersistence } from "../store/persistence";
import { pairedBrowsers, until, engineUrl, type Browser } from "./testing/support";

const DELAYS = { debounceMs: 30, pollMs: 5_000, retryMs: [100, 1000] as [number, number], socketMs: [100, 1000] as [number, number] };

function run(b: Browser, online = { on: true }) {
  const c = new SyncController(b.services, b.store, { baseUrl: engineUrl, delays: DELAYS, online: () => online.on });
  c.start();
  return c;
}

describe.skipIf(!engineUrl)("record sync against a real engine", () => {
  it("a task made on A appears on B, both edit offline and converge, and a delete propagates", async () => {
    const { a, b } = await pairedBrowsers(`e2e-sync-${Date.now()}@example.com`);
    const aOnline = { on: true };
    const bOnline = { on: true };
    const ca = run(a, aOnline);
    const cb = run(b, bOnline);
    try {
      await until("both to sync", () => ca.getState().lastSyncedAt !== null && cb.getState().lastSyncedAt !== null && ca.getState().live && cb.getState().live);
      expect(ca.getState().devices).toBe(2);

      // A task on A reaches B over the socket.
      const task = a.store.addTask({ title: "Buy milk", notes: "" });
      await until("the task to reach B", () => b.store.getState().tasks.some((t) => t.id === task.id));
      expect(a.store.getState().outbox).toEqual([]);

      // Both edit while offline, different fields and the same one.
      aOnline.on = false;
      bOnline.on = false;
      await new Promise((r) => setTimeout(r, 20));
      a.store.updateTask(task.id, { notes: "from A" });
      await new Promise((r) => setTimeout(r, 15));
      b.store.updateTask(task.id, { priority: "high", title: "Buy oat milk" });
      await new Promise((r) => setTimeout(r, 15));
      a.store.updateTask(task.id, { title: "Buy milk and eggs" }); // the latest edit of the title
      expect(a.store.getState().outbox.length).toBeGreaterThan(0);
      aOnline.on = true;
      bOnline.on = true;
      ca.syncNow();
      cb.syncNow();
      await until("the two to converge", () => {
        const x = a.store.getState().tasks.find((t) => t.id === task.id);
        const y = b.store.getState().tasks.find((t) => t.id === task.id);
        return x?.title === "Buy milk and eggs" && y?.title === "Buy milk and eggs" && x.notes === "from A" && y?.notes === "from A" && x.priority === "high" && y?.priority === "high";
      });

      // A list made on B shows on A over the socket, with its task.
      const list = b.store.addList("Trip", "c3");
      b.store.addTask({ title: "Passport", listId: list.id });
      await until("the list to reach A", () => a.store.getState().lists.some((l) => l.id === list.id) && a.store.getState().tasks.some((t) => t.title === "Passport"));

      // A soft delete travels as an edit.
      a.store.deleteTask(task.id);
      await until("the delete to reach B", () => b.store.getState().tasks.find((t) => t.id === task.id)?.deletedAt != null);

      // And a hard delete (the purge after 30 days) is a signed delete that removes it on B.
      ca.stop();
      await a.persistence.apply({ at: new Date().toISOString(), patches: [{ type: "task", id: task.id, op: "purge", key: "purge" }] });
      const reloaded = new LocalStore({ persistence: a.persistence, broadcast: false });
      await reloaded.ready;
      const again = run({ ...a, store: reloaded });
      await until("the purge to reach B", () => !b.store.getState().tasks.some((t) => t.id === task.id));
      again.stop();
    } finally {
      ca.stop();
      cb.stop();
    }
  }, 120_000);

  it("what was made on this device alone is added to the account and reaches the other device", async () => {
    const { a, b } = await pairedBrowsers(`e2e-adopt-${Date.now()}@example.com`);
    // The planner kept on A's device alone, from before it signed in.
    const deviceOnly = new LocalStore({ persistence: new MemoryPersistence(), broadcast: false });
    await deviceOnly.ready;
    const trip = deviceOnly.addList("Trip", "c3");
    const task = deviceOnly.addTask({ title: "Passport", listId: trip.id });
    deviceOnly.addEvent({ title: "Flight", start: "2026-12-01T09:00", end: "2026-12-01T11:00" });
    expect(a.store.adopt(deviceOnly.getState())).toBe(3);
    const ca = run(a);
    const cb = run(b);
    try {
      await until("the records to reach B", () => b.store.getState().tasks.some((t) => t.id === task.id) && b.store.getState().lists.some((l) => l.id === trip.id) && b.store.getState().events.some((e) => e.title === "Flight"));
      await until("A's outbox to clear", () => a.store.getState().outbox.length === 0);
    } finally {
      ca.stop();
      cb.stop();
    }
  }, 120_000);

  it("the live socket stays connected past the server's keep-alive: the client answers its pings (no reconnect in 70 s of silence)", async () => {
    const { a, b } = await pairedBrowsers(`e2e-keepalive-${Date.now()}@example.com`);
    const Real = globalThis.WebSocket;
    let opened = 0;
    globalThis.WebSocket = class extends Real {
      constructor(...args: ConstructorParameters<typeof Real>) {
        super(...args);
        opened++;
      }
    } as typeof Real;
    const ca = run(a);
    const cb = run(b);
    try {
      await until("both to be live", () => ca.getState().live && cb.getState().live);
      const before = opened;
      // The server pings every 30 s and closes a socket that has sent nothing for two intervals (60 s).
      await new Promise((r) => setTimeout(r, 70_000));
      expect(opened).toBe(before); // never reconnected
      expect(ca.getState().live && cb.getState().live).toBe(true);
      const task = a.store.addTask({ title: "Still live after the keep-alive" });
      await until("the task to reach B over the same socket", () => b.store.getState().tasks.some((t) => t.id === task.id));
    } finally {
      ca.stop();
      cb.stop();
      globalThis.WebSocket = Real;
    }
  }, 150_000);
});
