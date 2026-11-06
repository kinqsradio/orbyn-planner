// The expansion and the edits work on dates and wall-clock times, so a daylight-saving change must
// not move anything. This file runs in New York, where the clocks went forward on 8 March 2026.
(globalThis as unknown as { process: { env: Record<string, string> } }).process.env.TZ = "America/New_York";

import { describe, expect, it } from "vitest";
import { LocalStore } from "./LocalStore";
import { MemoryPersistence } from "./persistence";
import { editOccurrence } from "./eventScope";
import { expandEvents } from "./occurrences";
import { isAllDayLike } from "../features/calendar/layout";
import { repeatEvery } from "./repeat";

async function monFri() {
  const store = new LocalStore({ persistence: new MemoryPersistence(), now: () => new Date(2026, 2, 1, 12, 0), broadcast: false });
  await store.ready;
  store.addEvent({
    title: "Run",
    start: "2026-03-02T09:00",
    end: "2026-03-02T10:00",
    repeat: { ...repeatEvery("weekly"), weekdays: ["mon", "fri"] },
  });
  return store;
}

describe("daylight saving (America/New_York)", () => {
  it("the zone is really New York in this file", () => {
    expect(new Date(2026, 2, 7, 12).getTimezoneOffset()).toBe(300);
    expect(new Date(2026, 2, 9, 12).getTimezoneOffset()).toBe(240);
  });

  it("a series keeps 09:00 across the change", async () => {
    const store = await monFri();
    const starts = expandEvents(store.getState().events, "2026-03-01", "2026-03-20").map((o) => o.start);
    expect(starts.every((s) => s.endsWith("T09:00"))).toBe(true);
    expect(starts).toContain("2026-03-09T09:00");
  });

  it("moving the 9 March occurrence to Friday 6 March at 09:00, for All, stays at 09:00", async () => {
    const store = await monFri();
    const occ = expandEvents(store.getState().events, "2026-03-09", "2026-03-09")[0]!;
    editOccurrence(store, occ, "all", { start: "2026-03-06T09:00", end: "2026-03-06T10:00" });
    const after = expandEvents(store.getState().events, "2026-02-20", "2026-03-31");
    expect(after.length).toBeGreaterThan(6);
    expect(after.every((o) => o.start.endsWith("T09:00") && o.end.endsWith("T10:00"))).toBe(true);
    expect(after.some((o) => o.date === "2026-03-06")).toBe(true);
    expect(after.some((o) => o.date === "2026-03-09")).toBe(false); // Monday became Friday, Friday became Tuesday
    expect(store.getState().events[0]!.repeat!.repeat.weekdays).toEqual(["fri", "tue"]);
  });

  it("changing the time across the change keeps the wall-clock length", async () => {
    const store = await monFri();
    const occ = expandEvents(store.getState().events, "2026-03-09", "2026-03-09")[0]!;
    editOccurrence(store, occ, "all", { start: "2026-03-09T07:30", end: "2026-03-09T09:00" });
    const after = expandEvents(store.getState().events, "2026-03-01", "2026-03-20");
    expect(after.every((o) => o.start.endsWith("T07:30") && o.end.endsWith("T09:00"))).toBe(true);
  });

  it("a day-and-a-bit that is 24 wall-clock hours across the change is still all-day-like", () => {
    const event = { start: "2026-03-07T09:00", end: "2026-03-08T09:00" };
    const occ = { event: {} as never, date: "2026-03-07", ...event, allDay: false };
    // 23 real hours, 24 on the wall clock.
    expect(new Date(2026, 2, 8, 9).getTime() - new Date(2026, 2, 7, 9).getTime()).toBe(23 * 3_600_000);
    expect(isAllDayLike(occ)).toBe(true);
    expect(isAllDayLike({ ...occ, end: "2026-03-08T08:59" })).toBe(false);
  });
});
