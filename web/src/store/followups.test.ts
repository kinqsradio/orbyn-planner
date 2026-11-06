import { describe, expect, it, vi } from "vitest";
import { undoableEvents } from "./eventScope";
import { LocalStore } from "./LocalStore";
import { expandEvents } from "./occurrences";
import { MemoryPersistence } from "./persistence";
import { repeatEvery } from "./repeat";
import { editTaskRepeat, undoableTasks } from "./taskRepeat";
import { editOccurrence } from "./eventScope";
import type { Task } from "./types";

async function setup(now = new Date(2026, 10, 7, 10, 0)) {
  const store = new LocalStore({ persistence: new MemoryPersistence(), now: () => now, broadcast: false });
  await store.ready;
  return store;
}
const task = (s: LocalStore, id: string): Task => s.getState().tasks.find((t) => t.id === id)!;

describe("completedAt uses the store clock", () => {
  it("finishing a series by replacing its last date stamps the store's time", async () => {
    const store = await setup(new Date(2031, 0, 5, 8, 30));
    const t = store.addTask({ title: "Pills", due: "2031-01-01", repeat: { ...repeatEvery("daily"), end: { type: "count", value: 2 } } });
    store.setDone(t.id, true);
    editTaskRepeat(store, task(store, t.id), { due: "2031-01-09" }, "this", "2031-01-05");
    expect(task(store, t.id).completedAt).toBe(new Date(2031, 0, 5, 8, 30).toISOString());
  });
});

describe("undo after a repeat scope edit", () => {
  it("a task's This task edit goes back: the series, its due and the copy", async () => {
    const store = await setup();
    const t = store.addTask({ title: "Review", due: "2026-11-09", repeat: repeatEvery("weekly") });
    const { undo } = undoableTasks(store, () => editTaskRepeat(store, task(store, t.id), { due: "2026-11-11" }, "this", "2026-11-07"));
    expect(store.getState().tasks.filter((x) => x.deletedAt === null)).toHaveLength(2);
    undo();
    expect(task(store, t.id)).toMatchObject({ due: "2026-11-09", repeat: { skipped: [] } });
    expect(store.getState().tasks.filter((x) => x.deletedAt === null)).toHaveLength(1);
  });

  it("a task's All move goes back with its copies", async () => {
    const store = await setup();
    const t = store.addTask({ title: "Review", due: "2026-11-09", repeat: { ...repeatEvery("weekly"), weekdays: ["mon", "wed"] } });
    editTaskRepeat(store, task(store, t.id), { due: "2026-11-11" }, "this", "2026-11-07");
    const { undo } = undoableTasks(store, () => editTaskRepeat(store, task(store, t.id), { due: "2026-11-12" }, "all", "2026-11-07"));
    const moved = task(store, t.id).repeat!.repeat.weekdays;
    undo();
    expect(task(store, t.id).repeat!.repeat.weekdays).not.toEqual(moved);
    expect(task(store, t.id).repeat!.repeat.weekdays).toEqual(["mon", "wed"]);
    expect(store.getState().tasks.find((x) => x.overrideOf)!).toMatchObject({ due: "2026-11-11", overrideOf: { date: "2026-11-09" } });
  });

  it("an event's This event, This and following and All edits go back", async () => {
    for (const scope of ["this", "following", "all"] as const) {
      const store = await setup();
      const cal = store.getState().calendars.find((c) => c.kind.type === "local")!;
      const e = store.addEvent({ title: "Stand-up", calendarId: cal.id, start: "2026-11-02T09:00", end: "2026-11-02T09:30", series: { start: "2026-11-02", repeat: repeatEvery("weekly"), skipped: [] } });
      const before = JSON.stringify(store.getState().events.map((x) => [x.id, x.title, x.start, x.end, x.repeat, x.deletedAt]));
      const occ = expandEvents(store.getState().events, "2026-11-09", "2026-11-09")[0]!;
      const { undo } = undoableEvents(store, () =>
        editOccurrence(store, occ, scope, { title: "Moved", start: "2026-11-09T10:00", end: "2026-11-09T10:30" }),
      );
      expect(store.getState().events.filter((x) => x.deletedAt === null).some((x) => x.title === "Moved")).toBe(true);
      undo();
      const live = store.getState().events.filter((x) => x.deletedAt === null);
      expect(live.map((x) => [x.id, x.title, x.start, x.end, x.repeat, x.deletedAt])).toEqual(JSON.parse(before).map((x: unknown[]) => [x[0], x[1], x[2], x[3], x[4], x[5]]));
      void e;
    }
  });
});

describe("the occurrence expansion", () => {
  it("reads the viewer's time zone once per expansion, however many zoned events", async () => {
    const store = await setup();
    const cal = store.getState().calendars.find((c) => c.kind.type === "local")!;
    for (let i = 0; i < 30; i++) store.addEvent({ title: `E${i}`, calendarId: cal.id, start: "2026-11-02T09:00", end: "2026-11-02T10:00", zone: "Europe/London" });
    const spy = vi.spyOn(Intl, "DateTimeFormat");
    expandEvents(store.getState().events, "2026-11-01", "2026-12-12");
    const asked = spy.mock.calls.filter((c) => c.length === 0).length;
    spy.mockRestore();
    expect(asked).toBe(1);
  });

  it("remembers only a few ranges per event", async () => {
    const store = await setup();
    const cal = store.getState().calendars.find((c) => c.kind.type === "local")!;
    store.addEvent({ title: "Daily", calendarId: cal.id, start: "2026-11-02T09:00", end: "2026-11-02T10:00", series: { start: "2026-11-02", repeat: repeatEvery("daily"), skipped: [] } });
    const range = (i: number) => [`2026-11-0${(i % 9) + 1}`.replace("-0", "-0"), `2026-12-${String(i + 10).padStart(2, "0")}`] as const;
    const events = store.getState().events;
    const first = expandEvents(events, ...range(0))[0]!;
    expect(expandEvents(events, ...range(0))[0]).toBe(first); // cached
    for (let i = 1; i <= 8; i++) expandEvents(events, ...range(i)); // eight more fills past the cap
    expect(expandEvents(events, ...range(0))[0]).not.toBe(first); // the first was let go
  });
});
