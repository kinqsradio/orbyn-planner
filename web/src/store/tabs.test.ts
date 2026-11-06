import { IDBFactory } from "fake-indexeddb";
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LocalStore } from "./LocalStore";
import { IdbPersistence } from "./persistence";

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

const tab = (onReload = () => undefined) => new LocalStore({ persistence: new IdbPersistence(), onReload });

async function twoTabs() {
  const a = tab();
  const b = tab();
  await Promise.all([a.ready, b.ready]);
  await Promise.all([a.flush(), b.flush()]);
  return { a, b };
}

/** A fresh tab reading what is really in IndexedDB. */
async function stored() {
  const c = tab();
  await c.ready;
  return c.getState();
}

describe("two tabs on one database", () => {
  it("both add a task: two tasks, two task outbox records, one Inbox", async () => {
    const { a, b } = await twoTabs();
    a.addTask({ title: "from a" });
    b.addTask({ title: "from b" });
    await Promise.all([a.flush(), b.flush()]);
    const state = await stored();
    expect(state.tasks.map((t) => t.title).sort()).toEqual(["from a", "from b"]);
    expect(state.outbox.filter((e) => e.type === "task")).toHaveLength(2);
    expect(state.lists.filter((l) => l.isInbox)).toHaveLength(1);
    expect(new Set(state.outbox.map((e) => e.seq)).size).toBe(state.outbox.length);
  });

  it("each tab picks up the other's tasks", async () => {
    const { a, b } = await twoTabs();
    a.addTask({ title: "from a" });
    b.addTask({ title: "from b" });
    await Promise.all([a.flush(), b.flush()]);
    await vi.waitFor(() => {
      expect(a.getState().tasks).toHaveLength(2);
      expect(b.getState().tasks).toHaveLength(2);
    });
    expect(a.pendingChanges()).toBe(b.pendingChanges());
  });

  it("a stale tab's edit to another field does not revert the first tab's edit", async () => {
    const { a, b } = await twoTabs();
    const task = a.addTask({ title: "original" });
    await a.flush();
    await vi.waitFor(() => expect(b.getState().tasks).toHaveLength(1));
    // Both edit before either has heard from the other.
    a.updateTask(task.id, { title: "edited in a" });
    b.updateTask(task.id, { notes: "notes from b" });
    await Promise.all([a.flush(), b.flush()]);
    const state = await stored();
    expect(state.tasks[0]).toMatchObject({ title: "edited in a", notes: "notes from b" });
    const entry = state.outbox.find((e) => e.id === task.id)!;
    expect(entry.changedFields).toMatchObject({ title: "edited in a", notes: "notes from b" });
    await vi.waitFor(() => {
      expect(a.getState().tasks[0]).toMatchObject({ title: "edited in a", notes: "notes from b" });
      expect(b.getState().tasks[0]).toMatchObject({ title: "edited in a", notes: "notes from b" });
    });
  });

  it("a purge in one tab removes the task in the other", async () => {
    let now = new Date("2026-11-07T10:00:00Z");
    const clock = () => now;
    const a = new LocalStore({ persistence: new IdbPersistence(), now: clock });
    const b = new LocalStore({ persistence: new IdbPersistence(), now: clock });
    await Promise.all([a.ready, b.ready]);
    const task = a.addTask({ title: "to be purged" });
    a.deleteTask(task.id);
    await a.flush();
    await vi.waitFor(() => expect(b.getState().tasks).toHaveLength(1));
    now = new Date("2026-12-07T10:00:00Z");
    a.addTask({ title: "keeps the clock honest" });
    await a.flush();
    // A day later: the record above is old enough to vouch for the clock.
    now = new Date("2026-12-08T10:00:00Z");
    // A third tab opens a month later and purges on load; the others hear about it.
    const c = new LocalStore({ persistence: new IdbPersistence(), now: clock });
    await c.ready;
    await c.flush();
    expect(c.getState().tasks.map((t) => t.title)).toEqual(["keeps the clock honest"]);
    await vi.waitFor(() => expect(b.getState().tasks.map((t) => t.title)).toEqual(["keeps the clock honest"]));
    // Never synced, so the purge leaves nothing to send.
    expect((await stored()).outbox.filter((e) => e.id === task.id)).toHaveLength(0);
  });

  it("reloads when another tab upgrades the database", async () => {
    const onReload = vi.fn();
    const a = tab(onReload);
    await a.ready;
    // A newer version of the app opens the database in another tab.
    await new Promise<void>((resolve) => {
      const req = indexedDB.open("orbyn-planner", 99);
      req.onsuccess = () => {
        req.result.close();
        resolve();
      };
    });
    expect(onReload).toHaveBeenCalled();
    expect(a.getState().persistence).toMatchObject({ status: "failed" });
  });
});

describe("skipped dates from two tabs", () => {
  it("both skips survive, because each is a field of its own", async () => {
    const { a, b } = await twoTabs();
    const event = a.addEvent({
      title: "Stand-up",
      start: "2026-11-02T09:00",
      end: "2026-11-02T09:30",
      repeat: { frequency: "weekly", interval: 1, weekdays: [], end: { type: "never" } },
    });
    await a.flush();
    await vi.waitFor(() => expect(b.getState().events).toHaveLength(1));
    // Each tab skips a different date before hearing about the other.
    a.updateEvent(event.id, { repeat: { ...a.getState().events[0]!.repeat!, skipped: ["2026-11-09"] } });
    b.updateEvent(event.id, { repeat: { ...b.getState().events[0]!.repeat!, skipped: ["2026-11-16"] } });
    await Promise.all([a.flush(), b.flush()]);
    const state = await stored();
    expect(state.events[0]!.repeat!.skipped).toEqual(["2026-11-09", "2026-11-16"]);
    await vi.waitFor(() => {
      expect(a.getState().events[0]!.repeat!.skipped).toEqual(["2026-11-09", "2026-11-16"]);
      expect(b.getState().events[0]!.repeat!.skipped).toEqual(["2026-11-09", "2026-11-16"]);
    });
  });
});
