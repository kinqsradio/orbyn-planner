import { describe, expect, it } from "vitest";
import { LocalStore } from "./LocalStore";
import { MemoryPersistence } from "./persistence";
import { deleteOccurrence, duplicateOccurrence, editOccurrence } from "./eventScope";
import { expandEvents, repeatLabel } from "./occurrences";
import { repeatEvery } from "./repeat";

async function weekly() {
  const store = new LocalStore({ persistence: new MemoryPersistence(), now: () => new Date(2026, 10, 7, 10, 0) });
  await store.ready;
  // Mondays from 2 November, 09:00 to 10:00.
  const base = store.addEvent({
    title: "Stand-up",
    start: "2026-11-02T09:00",
    end: "2026-11-02T10:00",
    place: "Room 3",
    repeat: repeatEvery("weekly"),
  });
  const occ = (date: string) => {
    const o = expandEvents(store.getState().events, date, date).find((x) => x.date === date);
    if (!o) throw new Error(`no occurrence on ${date}`);
    return o;
  };
  const dates = (from: string, to: string) =>
    expandEvents(store.getState().events, from, to).map((o) => `${o.start} ${o.event.title}`);
  return { store, base, occ, dates };
}

describe("expandEvents", () => {
  it("places a series on each date and keeps its length", async () => {
    const { dates } = await weekly();
    expect(dates("2026-11-01", "2026-11-17")).toEqual([
      "2026-11-02T09:00 Stand-up",
      "2026-11-09T09:00 Stand-up",
      "2026-11-16T09:00 Stand-up",
    ]);
  });

  it("includes a multi-day event that began before the range, and all-day events", async () => {
    const { store } = await weekly();
    store.addEvent({ title: "Trip", allDay: true, start: "2026-10-30", end: "2026-11-03" });
    const onThird = expandEvents(store.getState().events, "2026-11-03", "2026-11-03");
    expect(onThird.map((o) => o.event.title)).toEqual(["Trip"]);
    expect(onThird[0]).toMatchObject({ allDay: true, start: "2026-10-30", end: "2026-11-03" });
  });

  it("labels repeats", async () => {
    const { base } = await weekly();
    expect(repeatLabel(null)).toBe("Never");
    expect(repeatLabel(base.repeat)).toBe("Every week");
    expect(repeatLabel({ ...base.repeat!, repeat: { ...base.repeat!.repeat, interval: 2 } })).toBe("Every 2 weeks");
    expect(repeatLabel({ ...base.repeat!, repeat: { ...base.repeat!.repeat, weekdays: ["tue", "thu"] } })).toBe("Every Tuesday and Thursday");
  });
});

describe("editing a repeating event with a scope", () => {
  it("This event: skips the date and adds a one-off with the change", async () => {
    const { store, occ, dates } = await weekly();
    const created = editOccurrence(store, occ("2026-11-09"), "this", { title: "Stand-up (moved)", start: "2026-11-09T11:00", end: "2026-11-09T12:00" });
    expect(created).toMatchObject({ title: "Stand-up (moved)", repeat: null, place: "Room 3" });
    expect(dates("2026-11-01", "2026-11-17")).toEqual([
      "2026-11-02T09:00 Stand-up",
      "2026-11-09T11:00 Stand-up (moved)",
      "2026-11-16T09:00 Stand-up",
    ]);
  });

  it("This and following: splits the series and changes the later half", async () => {
    const { store, occ, dates, base } = await weekly();
    editOccurrence(store, occ("2026-11-16"), "following", { title: "Planning", start: "2026-11-16T14:00", end: "2026-11-16T15:00" });
    expect(dates("2026-11-01", "2026-11-24")).toEqual([
      "2026-11-02T09:00 Stand-up",
      "2026-11-09T09:00 Stand-up",
      "2026-11-16T14:00 Planning",
      "2026-11-23T14:00 Planning",
    ]);
    expect(store.getState().events.find((e) => e.id === base.id)!.repeat!.repeat.end).toEqual({ type: "until", value: "2026-11-15" });
  });

  it("All events: changes every occurrence, moving the series by the same amount", async () => {
    const { store, occ, dates } = await weekly();
    editOccurrence(store, occ("2026-11-09"), "all", { title: "Daily scrum", start: "2026-11-09T10:30", end: "2026-11-09T11:00" });
    expect(dates("2026-11-01", "2026-11-17")).toEqual([
      "2026-11-02T10:30 Daily scrum",
      "2026-11-09T10:30 Daily scrum",
      "2026-11-16T10:30 Daily scrum",
    ]);
    const base = store.getState().events[0]!;
    expect(base.end).toBe("2026-11-02T11:00");
  });

  it("All events can change the rule", async () => {
    const { store, occ } = await weekly();
    editOccurrence(store, occ("2026-11-02"), "all", { repeat: { ...repeatEvery("daily"), end: { type: "count", value: 3 } } });
    expect(expandEvents(store.getState().events, "2026-11-01", "2026-12-31")).toHaveLength(3);
    editOccurrence(store, expandEvents(store.getState().events, "2026-11-02", "2026-11-02")[0]!, "all", { repeat: null });
    expect(store.getState().events[0]!.repeat).toBeNull();
  });

  it("a plain event just changes", async () => {
    const { store } = await weekly();
    const one = store.addEvent({ title: "Dentist", start: "2026-11-14T15:00", end: "2026-11-14T15:45" });
    editOccurrence(store, expandEvents(store.getState().events, "2026-11-14", "2026-11-14")[0]!, "all", { place: "Main St" });
    expect(store.getState().events.find((e) => e.id === one.id)!.place).toBe("Main St");
  });
});

describe("deleting and duplicating", () => {
  it("This event and its Undo", async () => {
    const { store, occ, dates } = await weekly();
    const undo = deleteOccurrence(store, occ("2026-11-09"), "this");
    expect(dates("2026-11-01", "2026-11-17")).toEqual(["2026-11-02T09:00 Stand-up", "2026-11-16T09:00 Stand-up"]);
    undo();
    expect(dates("2026-11-01", "2026-11-17")).toHaveLength(3);
  });

  it("This and following ends the series before the date; Undo restores it", async () => {
    const { store, occ, dates } = await weekly();
    const undo = deleteOccurrence(store, occ("2026-11-16"), "following");
    expect(dates("2026-11-01", "2026-12-31")).toEqual(["2026-11-02T09:00 Stand-up", "2026-11-09T09:00 Stand-up"]);
    undo();
    expect(dates("2026-11-01", "2026-11-24")).toHaveLength(4);
  });

  it("All events deletes softly and Undo puts it back", async () => {
    const { store, occ, base } = await weekly();
    const undo = deleteOccurrence(store, occ("2026-11-09"), "all");
    expect(store.getState().events.find((e) => e.id === base.id)!.deletedAt).not.toBeNull();
    expect(expandEvents(store.getState().events, "2026-11-01", "2026-12-31")).toHaveLength(0);
    undo();
    expect(expandEvents(store.getState().events, "2026-11-01", "2026-11-03")).toHaveLength(1);
  });

  it("duplicates one occurrence as a standalone event", async () => {
    const { store, occ } = await weekly();
    const copy = duplicateOccurrence(store, occ("2026-11-09"));
    expect(copy).toMatchObject({ title: "Stand-up", start: "2026-11-09T09:00", end: "2026-11-09T10:00", repeat: null, place: "Room 3" });
    expect(copy.id).not.toBe(store.getState().events[0]!.id);
  });
});

describe("expandEvents and midnight", () => {
  it("an event ending at 00:00 does not appear on the next day", async () => {
    const { store } = await weekly();
    store.addEvent({ title: "Late film", start: "2026-11-06T21:00", end: "2026-11-07T00:00" });
    const on = (d: string) => expandEvents(store.getState().events, d, d).map((o) => o.event.title);
    expect(on("2026-11-06")).toContain("Late film");
    expect(on("2026-11-07")).not.toContain("Late film");
  });
});
