import { describe, expect, it } from "vitest";
import { LocalStore } from "./LocalStore";
import { MemoryPersistence } from "./persistence";
import { inOrder } from "./order";
import { newSeries, repeatEvery } from "./repeat";
import { editTaskRepeat } from "./taskRepeat";

async function setup(now = new Date(2026, 10, 7, 10, 0)) {
  const store = new LocalStore({ persistence: new MemoryPersistence(), now: () => now, broadcast: false });
  await store.ready;
  return store;
}
const task = (s: LocalStore, id: string) => s.getState().tasks.find((t) => t.id === id)!;

describe("projects and sections", () => {
  it("creates, changes and finishes a project", async () => {
    const store = await setup();
    const p = store.addProject({ name: "  Home renovation ", colour: "c3", goal: "2027-01-30" });
    expect(p).toMatchObject({ name: "Home renovation", colour: "c3", goal: "2027-01-30", sections: [], archived: false });
    store.updateProject(p.id, { name: "Renovation", archived: true, goal: null });
    expect(store.getState().projects[0]).toMatchObject({ name: "Renovation", archived: true, goal: null });
  });

  it("keeps one outbox entry for a project however it is edited", async () => {
    const store = await setup();
    const before = store.pendingChanges();
    const p = store.addProject({ name: "Trip", colour: "c1" });
    store.addSection(p.id, "Flights");
    store.updateProject(p.id, { goal: "2027-03-01" });
    await store.flush();
    expect(store.pendingChanges()).toBe(before + 1);
    expect(store.getState().outbox.find((e) => e.id === p.id)).toMatchObject({ type: "project", op: "create" });
  });

  it("adds sections in order, renames and reorders them without touching the others", async () => {
    const store = await setup();
    const p = store.addProject({ name: "Home", colour: "c3" });
    const [a, b, c] = ["Kitchen", "Bathroom", "Garden"].map((n) => store.addSection(p.id, n)) as [
      ReturnType<typeof store.addSection>, ReturnType<typeof store.addSection>, ReturnType<typeof store.addSection>,
    ];
    const names = () => inOrder(store.getState().projects[0]!.sections).map((s) => s.name);
    expect(names()).toEqual(["Kitchen", "Bathroom", "Garden"]);
    store.renameSection(p.id, b.id, " Bathrooms ");
    expect(names()).toEqual(["Kitchen", "Bathrooms", "Garden"]);

    const keys = () => Object.fromEntries(store.getState().projects[0]!.sections.map((s) => [s.name, s.order]));
    const before = keys();
    store.moveSection(p.id, c.id, "up");
    expect(names()).toEqual(["Kitchen", "Garden", "Bathrooms"]);
    expect(keys().Kitchen).toBe(before.Kitchen);
    expect(keys().Bathrooms).toBe(before.Bathrooms);
    store.moveSection(p.id, a.id, "down");
    expect(names()).toEqual(["Garden", "Kitchen", "Bathrooms"]);
    store.moveSection(p.id, a.id, "down");
    store.moveSection(p.id, a.id, "down"); // already last: nothing happens
    expect(names()).toEqual(["Garden", "Bathrooms", "Kitchen"]);
    store.moveSection(p.id, c.id, "up"); // already first
    expect(names()).toEqual(["Garden", "Bathrooms", "Kitchen"]);
  });

  it("deleting a section moves its tasks to No section", async () => {
    const store = await setup();
    const p = store.addProject({ name: "Home", colour: "c3" });
    const kitchen = store.addSection(p.id, "Kitchen");
    const bath = store.addSection(p.id, "Bathroom");
    const t1 = store.addTask({ title: "tiles", projectId: p.id, sectionId: kitchen.id });
    const t2 = store.addTask({ title: "quotes", projectId: p.id, sectionId: bath.id });
    store.deleteSection(p.id, kitchen.id);
    expect(store.getState().projects[0]!.sections.map((s) => s.name)).toEqual(["Bathroom"]);
    expect(task(store, t1.id)).toMatchObject({ projectId: p.id, sectionId: null });
    expect(task(store, t2.id).sectionId).toBe(bath.id);
  });

  it("tasks take a project and section, and default to none", async () => {
    const store = await setup();
    expect(store.addTask({ title: "plain" })).toMatchObject({ projectId: null, sectionId: null, repeat: null, reminder: null, completions: [] });
  });
});

describe("completing a repeating task", () => {
  it("moves the due to the next occurrence at the same time and records the completion", async () => {
    const store = await setup();
    const t = store.addTask({ title: "Water plants", due: "2026-11-09T09:30", repeat: repeatEvery("weekly") });
    store.setDone(t.id, true);
    expect(task(store, t.id)).toMatchObject({ done: false, completedAt: null, due: "2026-11-16T09:30" });
    expect(task(store, t.id).completions).toHaveLength(1);
    store.setDone(t.id, true);
    expect(task(store, t.id)).toMatchObject({ due: "2026-11-23T09:30" });
    expect(task(store, t.id).completions).toHaveLength(2);
  });

  it("keeps a date-only due date-only", async () => {
    const store = await setup();
    const t = store.addTask({ title: "Bins", due: "2026-11-07", repeat: repeatEvery("daily") });
    store.setDone(t.id, true);
    expect(task(store, t.id).due).toBe("2026-11-08");
  });

  it("a monthly task on the 31st skips the short months", async () => {
    const store = await setup();
    const t = store.addTask({ title: "Pay rent", due: "2026-01-31", repeat: repeatEvery("monthly") });
    const dues: (string | null)[] = [];
    for (let i = 0; i < 3; i++) {
      store.setDone(t.id, true);
      dues.push(task(store, t.id).due);
    }
    expect(dues).toEqual(["2026-03-31", "2026-05-31", "2026-07-31"]);
  });

  it("skips dates taken out with This task only", async () => {
    const store = await setup();
    const t = store.addTask({ title: "Gym", due: "2026-11-02", repeat: repeatEvery("daily") });
    const series = { ...task(store, t.id).repeat!, skipped: ["2026-11-03"] };
    store.updateTask(t.id, { repeat: series });
    store.setDone(t.id, true);
    expect(task(store, t.id).due).toBe("2026-11-04");
  });

  it("a count end that is used up finishes the task", async () => {
    const store = await setup();
    const t = store.addTask({ title: "Course", due: "2026-11-02", repeat: { ...repeatEvery("daily"), end: { type: "count", value: 3 } } });
    store.setDone(t.id, true);
    store.setDone(t.id, true);
    expect(task(store, t.id)).toMatchObject({ done: false, due: "2026-11-04" });
    store.setDone(t.id, true);
    expect(task(store, t.id)).toMatchObject({ done: true, due: "2026-11-04" });
    expect(task(store, t.id).completedAt).not.toBeNull();
    expect(task(store, t.id).completions).toHaveLength(3);
  });

  it("an until date that has passed finishes the task", async () => {
    const store = await setup();
    const t = store.addTask({ title: "Trial", due: "2026-11-07", repeat: { ...repeatEvery("weekly"), end: { type: "until", value: "2026-11-10" } } });
    store.setDone(t.id, true);
    expect(task(store, t.id).done).toBe(true);
  });

  it("an ordinary task is simply done", async () => {
    const store = await setup();
    const t = store.addTask({ title: "Once", due: "2026-11-07" });
    store.setDone(t.id, true);
    expect(task(store, t.id)).toMatchObject({ done: true, due: "2026-11-07", completions: [] });
  });
});

describe("editing a repeating task's due or repeat", () => {
  async function weekly() {
    const store = await setup();
    const t = store.addTask({ title: "Review", due: "2026-11-09", repeat: { ...repeatEvery("weekly"), end: { type: "count", value: 5 } } });
    store.setDone(t.id, true); // now due 16 Nov, one of five used
    return { store, id: t.id };
  }
  const today = "2026-11-07";

  it("This task skips this date and makes a one-off copy linked to it", async () => {
    const { store, id } = await weekly();
    editTaskRepeat(store, task(store, id), { due: "2026-11-18" }, "this", today);
    expect(task(store, id).repeat).toMatchObject({ start: "2026-11-09", skipped: ["2026-11-16"] });
    expect(task(store, id).due).toBe("2026-11-23");
    const copy = store.getState().tasks.find((t) => t.overrideOf?.id === id)!;
    expect(copy).toMatchObject({ due: "2026-11-18", repeat: null, overrideOf: { id, date: "2026-11-16" } });
  });

  it("All moves the series by the same days, weekdays included, and keeps the whole count", async () => {
    const store = await setup();
    const t = store.addTask({ title: "Gym", due: "2026-11-09", repeat: { ...repeatEvery("weekly"), weekdays: ["mon", "wed"], end: { type: "count", value: 6 } } });
    editTaskRepeat(store, task(store, t.id), { due: "2026-11-10" }, "all", today);
    expect(task(store, t.id).repeat).toMatchObject({ start: "2026-11-10", repeat: { weekdays: ["tue", "thu"], end: { type: "count", value: 6 } } });
  });

  it("refuses a move that would split an every-other-week cycle", async () => {
    const store = await setup();
    const t = store.addTask({ title: "Gym", due: "2026-11-14", repeat: { ...repeatEvery("weekly"), interval: 2, weekdays: ["sat", "sun"] } });
    expect(() => editTaskRepeat(store, task(store, t.id), { due: "2026-11-15" }, "all", today)).toThrow();
  });

  it("This and following starts the rule at the new date with the rest of the count", async () => {
    const { store, id } = await weekly();
    editTaskRepeat(store, task(store, id), { due: "2026-11-18" }, "following", today);
    expect(task(store, id).due).toBe("2026-11-18");
    expect(task(store, id).repeat).toMatchObject({ start: "2026-11-18", repeat: { end: { type: "count", value: 4 } } });
  });

  it("a new rule replaces the old one for This and following and All, and not for This task", async () => {
    const { store, id } = await weekly();
    editTaskRepeat(store, task(store, id), { repeat: repeatEvery("monthly") }, "this", today);
    expect(task(store, id).repeat!.repeat.frequency).toBe("weekly");
    editTaskRepeat(store, task(store, id), { repeat: repeatEvery("monthly") }, "following", today);
    expect(task(store, id).repeat).toMatchObject({ start: "2026-11-16", repeat: { frequency: "monthly", end: { type: "never" } } });
  });

  it("stopping the repeat or clearing the due removes the repeat", async () => {
    const { store, id } = await weekly();
    editTaskRepeat(store, task(store, id), { repeat: null }, "all", today);
    expect(task(store, id).repeat).toBeNull();
    const t2 = store.addTask({ title: "Other", due: "2026-11-09", repeat: repeatEvery("daily") });
    editTaskRepeat(store, task(store, t2.id), { due: null }, "all", today);
    expect(task(store, t2.id)).toMatchObject({ due: null, repeat: null });
  });

  it("adding a repeat to a task without one starts it on its due date, or today", async () => {
    const store = await setup();
    const withDue = store.addTask({ title: "A", due: "2026-11-12" });
    editTaskRepeat(store, task(store, withDue.id), { repeat: repeatEvery("weekly") }, "all", today);
    expect(task(store, withDue.id).repeat).toMatchObject({ start: "2026-11-12" });
    const noDue = store.addTask({ title: "B" });
    editTaskRepeat(store, task(store, noDue.id), { repeat: repeatEvery("daily") }, "all", today);
    expect(task(store, noDue.id)).toMatchObject({ due: today, repeat: { start: today } });
    expect(newSeries(today, repeatEvery("daily")).start).toBe(today);
  });
});

describe("review fixes", () => {
  it("sections are stored one field each, so edits to different sections both survive", async () => {
    const store = await setup();
    const p = store.addProject({ name: "Home", colour: "c3" });
    const a = store.addSection(p.id, "Kitchen");
    const b = store.addSection(p.id, "Garden");
    await store.flush();
    store.renameSection(p.id, a.id, "Galley");
    store.deleteSection(p.id, b.id);
    const entry = store.getState().outbox.find((e) => e.id === p.id)!;
    const fields = JSON.stringify(entry);
    expect(fields).toContain(`section.${a.id}.name`);
    expect(fields).toContain(`section.${b.id}.removed`);
    expect(store.getState().projects[0]!.sections.map((x) => x.name)).toEqual(["Galley"]);
  });

  it("restoring a task whose section was deleted puts it at the project's top", async () => {
    const store = await setup();
    const p = store.addProject({ name: "Home", colour: "c3" });
    const k = store.addSection(p.id, "Kitchen");
    const t = store.addTask({ title: "tiles", projectId: p.id, sectionId: k.id });
    store.deleteTask(t.id);
    store.deleteSection(p.id, k.id);
    store.restoreTask(t.id);
    expect(task(store, t.id)).toMatchObject({ deletedAt: null, projectId: p.id, sectionId: null });
  });

  it("completing a repeating task unticks its steps for the next time", async () => {
    const store = await setup();
    const t = store.addTask({ title: "Clean", due: "2026-11-09", repeat: repeatEvery("weekly"), checklist: [{ id: "s1", title: "Sink", done: true, order: "a" }] });
    store.setDone(t.id, true);
    expect(task(store, t.id).checklist[0]!.done).toBe(false);
    expect(task(store, t.id).due).toBe("2026-11-16");
  });
});
