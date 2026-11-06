import { describe, expect, it } from "vitest";
import { LocalStore } from "./LocalStore";
import { MemoryPersistence } from "./persistence";
import { RepeatError, repeatEvery } from "./repeat";

function setup(start = "2026-11-07T10:00:00Z") {
  let t = new Date(start);
  let n = 0;
  const persistence = new MemoryPersistence();
  return {
    make: () => new LocalStore({ persistence, now: () => t, newId: () => `id${++n}` }),
    advance(days: number) {
      t = new Date(t.getTime() + days * 86_400_000);
    },
  };
}

const meeting = { title: "Team planning", start: "2026-11-07T09:00", end: "2026-11-07T11:00" };

describe("events and calendars in the store", () => {
  it("creates a Personal calendar on first load", async () => {
    const store = setup().make();
    await store.ready;
    expect(store.getState().calendars).toEqual([
      { id: expect.any(String), name: "Personal", colour: "c2", visible: true, kind: { type: "local" } },
    ]);
  });

  it("adds, updates, deletes and restores an event, each in the outbox", async () => {
    const store = setup().make();
    await store.ready;
    const before = store.pendingChanges();
    const e = store.addEvent({ ...meeting, place: " Room 3 ", reminder: 30, people: [{ email: "maya@example.com", response: "none" }] });
    expect(e).toMatchObject({ title: "Team planning", allDay: false, reminder: 30, readOnly: false, repeat: null });
    expect(e.calendarId).toBe(store.getState().calendars[0]!.id);
    store.updateEvent(e.id, { title: "Planning", place: "Room 4" });
    store.deleteEvent(e.id);
    expect(store.getState().events[0]!.deletedAt).not.toBeNull();
    store.restoreEvent(e.id);
    expect(store.getState().events[0]).toMatchObject({ title: "Planning", place: "Room 4", deletedAt: null });
    await store.flush();
    // One entry for the event, still a create, holding its latest values.
    const entries = store.getState().outbox.filter((x) => x.type === "event");
    expect(store.pendingChanges()).toBe(before + 1);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ op: "create", changedFields: { title: "Planning", place: "Room 4", deletedAt: null } });
  });

  it("builds a series from a rule and moves it with the event", async () => {
    const store = setup().make();
    await store.ready;
    const e = store.addEvent({ ...meeting, repeat: { ...repeatEvery("weekly"), interval: 2 } });
    expect(e.repeat).toEqual({ start: "2026-11-07", repeat: expect.objectContaining({ frequency: "weekly", interval: 2 }), skipped: [] });
    store.updateEvent(e.id, { start: "2026-11-09T09:00", end: "2026-11-09T11:00" });
    expect(store.getState().events[0]!.repeat!.start).toBe("2026-11-09");
  });

  it("refuses an invalid rule", async () => {
    const store = setup().make();
    await store.ready;
    expect(() => store.addEvent({ ...meeting, repeat: { ...repeatEvery("daily"), interval: 0 } })).toThrow(RepeatError);
    expect(store.getState().events).toHaveLength(0);
  });

  it("purges events deleted more than 30 days ago, on load", async () => {
    const env = setup();
    const first = env.make();
    await first.ready;
    const e = first.addEvent(meeting);
    first.deleteEvent(e.id);
    env.advance(30);
    first.addEvent({ ...meeting, title: "A later one" }); // brings the newest timestamp up to date
    await first.flush();
    env.advance(1);
    const second = env.make();
    await second.ready;
    await second.flush();
    expect(second.getState().events.map((x) => x.title)).toEqual(["A later one"]);
    // Never sent, so nothing is left for the engine to hear about.
    expect(second.getState().outbox.filter((x) => x.id === e.id)).toEqual([]);
  });

  it("adds and changes calendars, and subscriptions", async () => {
    const store = setup().make();
    await store.ready;
    const work = store.addCalendar(" Work ", "c1");
    store.updateCalendar(work.id, { name: "Job", visible: false, colour: "c4" });
    expect(store.getState().calendars.find((c) => c.id === work.id)).toMatchObject({ name: "Job", visible: false, colour: "c4" });
    const sub = store.addSubscription("Holidays", "c3", "https://example.com/h.ics");
    expect(sub.kind).toEqual({ type: "subscribed", url: "https://example.com/h.ics", lastRefreshed: null, error: null });
  });

  it("replaces a feed's events as read-only, outside the outbox, and records failures", async () => {
    const store = setup().make();
    await store.ready;
    const sub = store.addSubscription("Holidays", "c3", "https://example.com/h.ics");
    const pending = store.pendingChanges();
    store.replaceFeedEvents(sub.id, [{ title: "Bonfire night", start: "2026-11-05", end: "2026-11-05", allDay: true }]);
    store.replaceFeedEvents(sub.id, [{ title: "Diwali", start: "2026-11-08", end: "2026-11-08", allDay: true }]);
    const events = store.getState().events.filter((e) => e.calendarId === sub.id);
    expect(events.map((e) => e.title)).toEqual(["Diwali"]);
    expect(events[0]!.readOnly).toBe(true);
    expect(() => store.updateEvent(events[0]!.id, { title: "x" })).toThrow();
    expect(store.pendingChanges()).toBe(pending);
    expect(store.getState().calendars.find((c) => c.id === sub.id)!.kind).toMatchObject({ error: null, lastRefreshed: expect.any(String) });
    store.failSubscription(sub.id, "Couldn’t refresh");
    expect(store.getState().calendars.find((c) => c.id === sub.id)!.kind).toMatchObject({ error: "Couldn’t refresh" });
    expect(() => store.replaceFeedEvents(store.getState().calendars[0]!.id, [])).toThrow();
  });

  it("persists events and calendars", async () => {
    const env = setup();
    const first = env.make();
    await first.ready;
    first.addEvent(meeting);
    await first.flush();
    const second = env.make();
    await second.ready;
    expect(second.getState().events.map((e) => e.title)).toEqual(["Team planning"]);
    expect(second.getState().calendars).toHaveLength(1);
  });
});
