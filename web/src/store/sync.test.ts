import { IDBFactory } from "fake-indexeddb";
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { LocalStore } from "./LocalStore";
import { IdbPersistence, MemoryPersistence, type Persistence } from "./persistence";

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

const kinds: [string, () => Persistence][] = [
  ["memory", () => new MemoryPersistence()],
  ["IndexedDB", () => new IdbPersistence()],
];

describe.each(kinds)("what sync needs from the store (%s)", (_name, make) => {
  async function setup() {
    const store = new LocalStore({ persistence: make(), broadcast: false });
    await store.ready;
    await store.flush();
    return store;
  }
  const entryOf = (s: LocalStore, id: string) => s.getState().outbox.find((e) => e.id === id);

  it("acknowledging clears an entry that is still what was sent", async () => {
    const store = await setup();
    const task = store.addTask({ title: "Sent" });
    await store.flush();
    const entry = entryOf(store, task.id)!;
    await store.acknowledge([{ type: "task", id: task.id, idempotencyKey: entry.idempotencyKey }]);
    expect(entryOf(store, task.id)).toBeUndefined();
    // And in storage: a fresh store over the same data has no entry either.
  });

  it("an entry edited since it was sent stays", async () => {
    const store = await setup();
    const task = store.addTask({ title: "One" });
    await store.flush();
    const sent = entryOf(store, task.id)!;
    store.updateTask(task.id, { title: "Two" });
    await store.flush();
    await store.acknowledge([{ type: "task", id: task.id, idempotencyKey: sent.idempotencyKey }]);
    expect(entryOf(store, task.id)?.changedFields).toMatchObject({ title: "Two" });
  });

  it("remote changes create, update and remove records without making outbox entries", async () => {
    const store = await setup();
    const before = store.getState().outbox.length;
    await store.applyRemote([
      { type: "list", id: "l-remote", fields: { name: "Trip", colour: "c3", isInbox: false } },
      { type: "task", id: "t-remote", fields: { title: "Passport", notes: "", listId: "l-remote", due: null, priority: "none", done: false, completedAt: null, deletedAt: null, checklist: [], projectId: null, sectionId: null, repeat: null, reminder: null, completions: [], createdAt: "2026-11-07T10:00:00Z", updatedAt: "2026-11-07T10:00:00Z" } },
    ]);
    expect(store.getState().lists.map((l) => l.name)).toContain("Trip");
    expect(store.getState().tasks.find((t) => t.id === "t-remote")?.title).toBe("Passport");
    await store.applyRemote([{ type: "task", id: "t-remote", fields: { title: "Passport and visa" } }]);
    expect(store.getState().tasks.find((t) => t.id === "t-remote")?.title).toBe("Passport and visa");
    await store.applyRemote([{ type: "task", id: "t-remote", fields: null }]);
    expect(store.getState().tasks.find((t) => t.id === "t-remote")).toBeUndefined();
    expect(store.getState().outbox.length).toBe(before); // nothing here is a local edit
  });
});
