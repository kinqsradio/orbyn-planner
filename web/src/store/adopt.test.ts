// @vitest-environment node
import { describe, expect, it } from "vitest";
import { hasPlannerData } from "./deviceData";
import { LocalStore } from "./LocalStore";
import { MemoryPersistence } from "./persistence";

const make = async () => {
  const store = new LocalStore({ persistence: new MemoryPersistence(), broadcast: false });
  await store.ready;
  return store;
};

describe("taking in another planner", () => {
  it("an empty planner holds no data: the Inbox and Personal don't count", async () => {
    expect(hasPlannerData((await make()).getState())).toBe(false);
  });

  it("anything the person made counts", async () => {
    const s = await make();
    s.addList("Trip", "c3");
    expect(hasPlannerData(s.getState())).toBe(true);
    const t = await make();
    t.addTask({ title: "x" });
    expect(hasPlannerData(t.getState())).toBe(true);
  });

  it("adds its records as new local edits that wait in the outbox, and leaves the source untouched", async () => {
    const device = await make();
    const list = device.addList("Trip", "c3");
    const task = device.addTask({ title: "Passport", listId: list.id });
    const event = device.addEvent({ title: "Flight", start: "2026-12-01T09:00", end: "2026-12-01T11:00" });
    await device.flush();
    const before = JSON.stringify(device.getState());
    const account = await make();
    await account.flush();
    const waiting = account.getState().outbox.length;
    expect(account.adopt(device.getState())).toBe(3);
    await account.flush();
    expect(account.getState().tasks.map((t) => t.id)).toEqual([task.id]);
    expect(account.getState().lists.map((l) => l.id)).toContain(list.id);
    expect(account.getState().events.map((e) => e.id)).toEqual([event.id]);
    const entries = account.getState().outbox.filter((o) => [task.id, list.id, event.id].includes(o.id));
    expect(entries.map((o) => o.op)).toEqual(["create", "create", "create"]);
    expect(account.getState().outbox.length).toBe(waiting + 3);
    expect(JSON.stringify(device.getState())).toBe(before);
  });

  it("taking in the same planner twice adds nothing the second time", async () => {
    const device = await make();
    device.addTask({ title: "Once" });
    const account = await make();
    expect(account.adopt(device.getState())).toBe(1);
    expect(account.adopt(device.getState())).toBe(0);
    expect(account.getState().tasks).toHaveLength(1);
  });
});
