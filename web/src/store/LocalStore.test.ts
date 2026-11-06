import { describe, expect, it, vi } from "vitest";
import { INBOX_ID, LocalStore } from "./LocalStore";
import { MemoryPersistence, type Persistence } from "./persistence";

function setup(start = "2026-11-07T10:00:00Z") {
  let t = new Date(start);
  let n = 0;
  const persistence = new MemoryPersistence();
  const make = () => new LocalStore({ persistence, now: () => t, newId: () => `id${++n}`, broadcast: false });
  return {
    persistence,
    make,
    advance(days: number) {
      t = new Date(t.getTime() + days * 86_400_000);
    },
  };
}

describe("LocalStore", () => {
  it("creates an Inbox with a fixed id on first load", async () => {
    const store = setup().make();
    await store.ready;
    const { lists } = store.getState();
    expect(lists).toHaveLength(1);
    expect(lists[0]).toMatchObject({ id: INBOX_ID, name: "Inbox", isInbox: true });
  });

  it("adds, updates and completes, notifying subscribers", async () => {
    const store = setup().make();
    await store.ready;
    const listener = vi.fn();
    const off = store.subscribe(listener);
    const task = store.addTask({ title: "  Dentist ", due: "2026-11-14T15:00", priority: "high" });
    expect(task).toMatchObject({ title: "Dentist", priority: "high", done: false, listId: INBOX_ID });
    store.updateTask(task.id, { notes: "Bring card" });
    store.setDone(task.id, true);
    const stored = store.getState().tasks[0]!;
    expect(stored.notes).toBe("Bring card");
    expect(stored.done).toBe(true);
    expect(stored.completedAt).not.toBeNull();
    store.setDone(task.id, false);
    expect(store.getState().tasks[0]!.completedAt).toBeNull();
    expect(listener).toHaveBeenCalled();
    off();
    await store.flush();
    const calls = listener.mock.calls.length;
    store.updateTask(task.id, { title: "x" });
    expect(listener).toHaveBeenCalledTimes(calls);
  });

  it("keeps one outbox entry per record, folding edits into it", async () => {
    const store = setup().make();
    await store.ready;
    expect(store.pendingChanges()).toBe(1); // the Inbox
    const task = store.addTask({ title: "a" });
    store.updateTask(task.id, { title: "b" });
    store.updateTask(task.id, { notes: "n" });
    store.deleteTask(task.id);
    const list = store.addList("Errands", "c3");
    store.updateList(list.id, { name: "Chores" });
    await store.flush();
    const entries = store.getState().outbox;
    expect(entries.map((e) => `${e.type}:${e.op}`).sort()).toEqual(["list:create", "list:create", "task:create"]);
    expect(store.pendingChanges()).toBe(3);
    const entry = entries.find((e) => e.id === task.id)!;
    expect(entry.changedFields).toMatchObject({ title: "b", notes: "n", deletedAt: expect.any(String) });
    expect(entry.idempotencyKey).toBeTruthy();
    expect(entries.find((e) => e.id === list.id)!.changedFields).toMatchObject({ name: "Chores" });
    expect(new Set(entries.map((e) => e.seq)).size).toBe(3);
    expect(entries.every((e) => e.seq > 0)).toBe(true);
  });

  it("deletes softly and restores", async () => {
    const store = setup().make();
    await store.ready;
    const task = store.addTask({ title: "a" });
    store.deleteTask(task.id);
    expect(store.getState().tasks[0]!.deletedAt).not.toBeNull();
    store.restoreTask(task.id);
    expect(store.getState().tasks[0]!.deletedAt).toBeNull();
  });

  it("purges tasks deleted more than 30 days ago; one never synced leaves nothing to send", async () => {
    const env = setup();
    const first = env.make();
    await first.ready;
    const old = first.addTask({ title: "old" });
    const recent = first.addTask({ title: "recent" });
    first.deleteTask(old.id);
    env.advance(20);
    first.deleteTask(recent.id);
    env.advance(14);
    first.addTask({ title: "fresh" }); // brings the newest timestamp up to date
    await first.flush();
    env.advance(1);
    const second = env.make();
    await second.ready;
    await second.flush();
    expect(second.getState().tasks.map((t) => t.title)).toEqual(["recent", "fresh"]);
    // "old" was created and deleted on this device and never synced.
    expect(second.getState().outbox.filter((e) => e.id === old.id)).toHaveLength(0);
  });

  it("does not purge when the clock is far ahead of the newest record", async () => {
    const env = setup();
    const first = env.make();
    await first.ready;
    const task = first.addTask({ title: "binned" });
    first.deleteTask(task.id);
    await first.flush();
    env.advance(60);
    const second = env.make();
    await second.ready;
    expect(second.getState().tasks.map((t) => t.title)).toEqual(["binned"]);
  });

  it("persists records and the outbox", async () => {
    const env = setup();
    const first = env.make();
    await first.ready;
    first.addTask({ title: "kept" });
    await first.flush();
    const second = env.make();
    await second.ready;
    expect(second.getState().tasks.map((t) => t.title)).toEqual(["kept"]);
    expect(second.getState().lists).toHaveLength(1);
    expect(second.pendingChanges()).toBe(2);
  });

  it("refuses writes before it has loaded", () => {
    const store = setup().make();
    expect(() => store.addTask({ title: "early" })).toThrow();
  });
});

describe("when storage fails", () => {
  const failing = (over: Partial<Persistence>): Persistence => {
    const memory = new MemoryPersistence();
    return { durable: true, setHandlers: () => undefined, load: () => memory.load(), read: (r) => memory.read(r), apply: (b) => memory.apply(b), ...over };
  };

  it("reports a write that hits the storage quota, and keeps the change on screen", async () => {
    const memory = new MemoryPersistence();
    const quota = new DOMException("full", "QuotaExceededError");
    let failWrites = false;
    const persistence: Persistence = {
      durable: true,
      setHandlers: () => undefined,
      load: () => memory.load(),
      read: (r) => memory.read(r),
      apply: (b) => (failWrites ? Promise.reject(quota) : memory.apply(b)),
    };
    const store = new LocalStore({ persistence, broadcast: false });
    await store.ready;
    await store.flush();
    expect(store.getState().persistence).toEqual({ status: "ok" });
    failWrites = true;
    store.addTask({ title: "doomed" });
    await store.flush();
    expect(store.getState().persistence).toEqual({ status: "failed", reason: "This device is out of storage." });
    expect(store.getState().tasks.map((t) => t.title)).toEqual(["doomed"]);
  });

  it("reports another write failure in plain words", async () => {
    const memory = new MemoryPersistence();
    const persistence = failing({ load: () => memory.load(), apply: () => Promise.reject(new Error("disk")) });
    const store = new LocalStore({ persistence, broadcast: false });
    await store.ready;
    await store.flush();
    expect(store.getState().persistence).toEqual({ status: "failed", reason: "Couldn’t write to this device’s storage." });
  });

  it("a failed open is reported, not hidden by a fall-back to memory, and nothing is written", async () => {
    const apply = vi.fn();
    const persistence = failing({ load: () => Promise.reject(new Error("blocked")), apply });
    const store = new LocalStore({ persistence, broadcast: false });
    await store.ready;
    expect(store.getState().persistence).toEqual({ status: "failed", reason: "Couldn’t open this device’s storage." });
    store.addTask({ title: "on screen only" });
    await store.flush();
    expect(apply).not.toHaveBeenCalled();
    expect(store.getState().persistence.status).toBe("failed");
  });

  it("says nothing is saved when IndexedDB does not exist", async () => {
    const store = new LocalStore({ persistence: new MemoryPersistence({ volatile: true }), broadcast: false });
    await store.ready;
    expect(store.getState().persistence).toEqual({ status: "memory" });
  });
});
