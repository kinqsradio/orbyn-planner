// @vitest-environment node
import { describe, expect, it } from "vitest";
import { runCycle } from "./cycle";
import { createSyncRig, type TestDevice } from "./testing/rig";

const sync = (d: TestDevice) => runCycle(d.services, d.session, d.store);
const tagsOf = (d: TestDevice, taskId: string) => d.store.getState().tasks.find((t) => t.id === taskId)!.tags;

describe("tags through the engine", () => {
  it("definitions travel in the account's settings zone, and two devices adding different tags to one task offline both keep theirs", async () => {
    const r = await createSyncRig();
    const work = r.a.store.addTag("Work", "c1");
    const home = r.a.store.addTag("Home", "c2");
    const task = r.a.store.addTask({ title: "Plan the move" });
    for (const d of [r.a, r.b, r.a]) await sync(d);
    expect(r.b.store.getState().tags.map((t) => t.name).sort()).toEqual(["Home", "Work"]);
    expect([...r.engine.accounts.values()][0]!.records!.zones.has("settings")).toBe(true);

    // Both devices tag the same task while offline, with different tags.
    r.clock.now += 1000;
    r.a.store.setTaskTag(task.id, work.id, true);
    r.clock.now += 1000;
    r.b.store.setTaskTag(task.id, home.id, true);
    for (const d of [r.a, r.b, r.a, r.b]) await sync(d);
    expect(tagsOf(r.a, task.id)).toEqual([home.id, work.id].sort());
    expect(tagsOf(r.b, task.id)).toEqual([home.id, work.id].sort());

    // One device removes one of them: only that tag goes, on both.
    r.clock.now += 1000;
    r.a.store.setTaskTag(task.id, work.id, false);
    for (const d of [r.a, r.b]) await sync(d);
    expect(tagsOf(r.b, task.id)).toEqual([home.id]);
  });

  it("deleting a tag on one device hides it on the other, and the tasks keep the field until it is restored", async () => {
    const r = await createSyncRig();
    const tag = r.a.store.addTag("Errands", "c4");
    const task = r.a.store.addTask({ title: "Post office", tags: [tag.id] });
    for (const d of [r.a, r.b]) await sync(d);
    r.clock.now += 1000;
    r.a.store.deleteTag(tag.id);
    for (const d of [r.a, r.b]) await sync(d);
    expect(r.b.store.getState().tags.find((t) => t.id === tag.id)!.deletedAt).not.toBeNull();
    expect(tagsOf(r.b, task.id)).toEqual([tag.id]);
    r.clock.now += 1000;
    r.b.store.restoreTag(tag.id);
    for (const d of [r.b, r.a]) await sync(d);
    expect(r.a.store.getState().tags.find((t) => t.id === tag.id)!.deletedAt).toBeNull();
  });
});
