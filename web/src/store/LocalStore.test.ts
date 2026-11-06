import { describe, expect, it } from "vitest";
import { LocalStore } from "./LocalStore";
import { MemoryPersistence } from "./persistence";

function setup(start = "2026-11-07T10:00:00Z") {
  let t = new Date(start);
  let n = 0;
  const persistence = new MemoryPersistence();
  const make = () => new LocalStore({ persistence, now: () => t, newId: () => `id${++n}` });
  return {
    persistence,
    make,
    advance(days: number) {
      t = new Date(t.getTime() + days * 86_400_000);
    },
  };
}

describe("LocalStore", () => {
  it("creates an Inbox on first load", async () => {
    const store = setup().make();
    await store.ready;
    const { lists } = store.getState();
    expect(lists).toHaveLength(1);
    expect(lists[0]).toMatchObject({ name: "Inbox", isInbox: true });
  });

  it("adds, updates, completes and notifies", async () => {
    const store = setup().make();
    await store.ready;
    let calls = 0;
    const off = store.subscribe(() => calls++);
    const task = store.addTask({ title: "  Dentist ", due: "2026-11-14T15:00", priority: "high" });
    expect(task).toMatchObject({ title: "Dentist", priority: "high", done: false, listId: store.getState().lists[0]!.id });
    store.updateTask(task.id, { notes: "Bring card" });
    store.setDone(task.id, true);
    const stored = store.getState().tasks[0]!;
    expect(stored.notes).toBe("Bring card");
    expect(stored.done).toBe(true);
    expect(stored.completedAt).not.toBeNull();
    store.setDone(task.id, false);
    expect(store.getState().tasks[0]!.completedAt).toBeNull();
    expect(calls).toBe(4);
    off();
    store.updateTask(task.id, { title: "x" });
    expect(calls).toBe(4);
  });

  it("records every write in the outbox", async () => {
    const store = setup().make();
    await store.ready;
    expect(store.pendingChanges()).toBe(1); // the Inbox
    const task = store.addTask({ title: "a" });
    store.updateTask(task.id, { title: "b" });
    store.deleteTask(task.id);
    const list = store.addList("Errands", "c3");
    store.updateList(list.id, { name: "Chores" });
    const entries = store.getState().outbox.map((e) => `${e.type}:${e.op}`);
    expect(entries).toEqual(["list:create", "task:create", "task:update", "task:delete", "list:create", "list:update"]);
    expect(store.pendingChanges()).toBe(6);
    expect(store.getState().outbox.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6]);
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

  it("purges tasks deleted more than 30 days ago, on load", async () => {
    const env = setup();
    const first = env.make();
    await first.ready;
    const old = first.addTask({ title: "old" });
    const recent = first.addTask({ title: "recent" });
    first.deleteTask(old.id);
    env.advance(20);
    first.deleteTask(recent.id);
    env.advance(15);
    await first.flush();
    const second = env.make();
    await second.ready;
    expect(second.getState().tasks.map((t) => t.title)).toEqual(["recent"]);
    expect(second.getState().outbox.at(-1)).toMatchObject({ op: "purge", id: old.id });
  });

  it("persists through the persistence layer", async () => {
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
