// @vitest-environment node
import { describe, expect, it } from "vitest";
import { LocalStore } from "./LocalStore";
import { MemoryPersistence } from "./persistence";

async function make() {
  const persistence = new MemoryPersistence();
  const store = new LocalStore({ persistence, broadcast: false, now: () => new Date("2026-11-07T10:00:00Z") });
  await store.ready;
  return { store, persistence, reopen: async () => (await Promise.resolve(new LocalStore({ persistence, broadcast: false, now: () => new Date("2026-11-07T10:00:00Z") }))) };
}

describe("tags", () => {
  it("a tag is added to and removed from a task one field at a time, and each change is its own outbox field", async () => {
    const { store } = await make();
    const work = store.addTag("Work", "c1");
    const home = store.addTag("Home", "c2");
    const task = store.addTask({ title: "Plan" });
    await store.flush();
    store.setTaskTag(task.id, work.id, true);
    store.setTaskTag(task.id, home.id, true);
    expect(store.getState().tasks[0]!.tags).toEqual([home.id, work.id].sort());
    store.setTaskTag(task.id, work.id, false);
    expect(store.getState().tasks[0]!.tags).toEqual([home.id]);
    await store.flush();
    // Never a list field: the outbox holds `tag:<id>` fields (the task is still an unsent create here, so look at the stored record).
    const entry = store.getState().outbox.find((o) => o.id === task.id)!;
    expect(entry.changedFields[`tag:${home.id}`]).toBe(true);
    expect(entry.changedFields[`tag:${work.id}`]).toBe(false);
    expect(Object.keys(entry.changedFields)).not.toContain("tags");
  });

  it("deleting a tag hides it but the tasks keep their field, so restoring brings it back, across a reload", async () => {
    const { store, reopen } = await make();
    const tag = store.addTag("Errands", "c4");
    const task = store.addTask({ title: "Post office", tags: [tag.id] });
    store.deleteTag(tag.id);
    await store.flush();
    const again = await reopen();
    await again.ready;
    expect(again.getState().tags.find((t) => t.id === tag.id)!.deletedAt).not.toBeNull();
    expect(again.getState().tasks.find((t) => t.id === task.id)!.tags).toEqual([tag.id]); // the field stays
    again.restoreTag(tag.id);
    expect(again.getState().tags.find((t) => t.id === tag.id)!.deletedAt).toBeNull();
    expect(again.getState().tasks.find((t) => t.id === task.id)!.tags).toEqual([tag.id]);
  });

  it("a tag that has been deleted for 30 days is purged with the other deleted records", async () => {
    let now = new Date("2026-11-07T10:00:00Z");
    const store = new LocalStore({ persistence: new MemoryPersistence(), broadcast: false, now: () => now });
    await store.ready;
    const tag = store.addTag("Old", "c1");
    store.addTask({ title: "Keeps the clock honest" });
    store.deleteTag(tag.id);
    now = new Date("2026-12-08T10:00:00Z");
    store.addTask({ title: "A later one" });
    now = new Date("2026-12-08T10:05:00Z");
    expect(store.purgeDeleted()).toBeGreaterThanOrEqual(1);
    expect(store.getState().tags.some((t) => t.id === tag.id)).toBe(false);
  });
});
