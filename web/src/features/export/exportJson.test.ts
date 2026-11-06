// @vitest-environment node
import { describe, expect, it } from "vitest";
import { LocalStore } from "../../store/LocalStore";
import { MemoryPersistence } from "../../store/persistence";
import { repeatEvery } from "../../store/repeat";
import { buildExport, EXPORT_VERSION, exportJson, readExport } from "./exportJson";

async function filledStore() {
  const store = new LocalStore({ persistence: new MemoryPersistence(), broadcast: false, now: () => new Date("2026-11-07T10:00:00Z") });
  await store.ready;
  const trip = store.addList("Trip", "c3");
  store.addTask({ title: "Passport", listId: trip.id, due: "2026-11-20", priority: "high", checklist: [{ id: "c1", title: "Photos", done: false, order: "a" }] });
  const gone = store.addTask({ title: "Deleted one" });
  store.deleteTask(gone.id);
  const project = store.addProject({ name: "Launch", colour: "c1", goal: "2026-12-01" });
  store.addSection(project.id, "Plan");
  store.addTask({ title: "In the project", projectId: project.id });
  store.addTask({ title: "Weekly", due: "2026-11-09", repeat: repeatEvery("weekly") });
  store.addEvent({ title: "Dentist", start: "2026-11-14T15:00", end: "2026-11-14T16:00", people: [{ email: "a@b.co", response: "accepted" }], repeat: repeatEvery("monthly") });
  const old = store.addEvent({ title: "Cancelled", start: "2026-11-15T09:00", end: "2026-11-15T10:00" });
  store.deleteEvent(old.id);
  store.addCalendar("Work", "c4");
  await store.flush();
  return store;
}

describe("the JSON export", () => {
  it("round-trips everything on the device, with a version, the trash apart, and no sync state, keys or tokens", async () => {
    const store = await filledStore();
    const state = store.getState();
    expect(state.outbox.length).toBeGreaterThan(0); // there is sync state to leave out
    const text = exportJson(state, "2026-11-07T10:00:00.000Z");
    const back = readExport(text);

    expect(back).toEqual(buildExport(state, "2026-11-07T10:00:00.000Z"));
    expect(back.formatVersion).toBe(EXPORT_VERSION);
    expect(Object.keys(back).sort()).toEqual(["calendars", "events", "exportedAt", "format", "formatVersion", "lists", "projects", "tasks", "trash"]);
    expect(back.tasks.map((t) => t.title).sort()).toEqual(["In the project", "Passport", "Weekly"]);
    expect(back.trash.tasks.map((t) => t.title)).toEqual(["Deleted one"]);
    expect(back.events.map((e) => e.title)).toEqual(["Dentist"]);
    expect(back.trash.events.map((e) => e.title)).toEqual(["Cancelled"]);
    expect(back.projects[0]!.sections.map((s) => s.name)).toEqual(["Plan"]);
    expect(back.lists.map((l) => l.name)).toEqual(expect.arrayContaining(["Inbox", "Trip"]));
    expect(back.calendars.map((c) => c.name)).toEqual(expect.arrayContaining(["Personal", "Work"]));
    expect(back.tasks.find((t) => t.title === "Weekly")!.repeat!.repeat.frequency).toBe("weekly");
    expect(text).not.toMatch(/outbox|idempotency|token|secret|password|"keys"|snapshot/i);
  });

  it.each([
    ["not JSON", "hello"],
    ["another kind of JSON", JSON.stringify({ tasks: [] })],
    ["a newer version", JSON.stringify({ format: "orbyn-planner-export", formatVersion: EXPORT_VERSION + 1, lists: [], tasks: [], projects: [], calendars: [], events: [], trash: { tasks: [], events: [] } })],
    ["version 0", JSON.stringify({ format: "orbyn-planner-export", formatVersion: 0, lists: [], tasks: [], projects: [], calendars: [], events: [], trash: { tasks: [], events: [] } })],
    ["version -1", JSON.stringify({ format: "orbyn-planner-export", formatVersion: -1, lists: [], tasks: [], projects: [], calendars: [], events: [], trash: { tasks: [], events: [] } })],
    ["version 0.5", JSON.stringify({ format: "orbyn-planner-export", formatVersion: 0.5, lists: [], tasks: [], projects: [], calendars: [], events: [], trash: { tasks: [], events: [] } })],
    ["a missing part", JSON.stringify({ format: "orbyn-planner-export", formatVersion: 1, lists: [] })],
  ])("refuses %s", (_name, text) => {
    expect(() => readExport(text)).toThrow(/Orbyn Planner/);
  });
});
