import { describe, expect, it } from "vitest";
import type { Occurrence } from "../../store/occurrences";
import type { CalendarEvent } from "../../store/types";
import { countOverlaps, layoutDay, isAllDayLike } from "./layout";

let n = 0;
function occ(start: string, end: string, allDay = false): Occurrence {
  const event = { id: `e${++n}`, title: `E${n}`, allDay, start, end } as CalendarEvent;
  return { event, date: start.slice(0, 10), start, end, allDay };
}

const DAY = "2026-11-07";
const t = (hm: string) => `${DAY}T${hm}`;
const place = (list: Occurrence[]) => layoutDay(list, DAY).map((p) => [p.occ.event.title, p.top, p.height, p.column, p.columns, p.overlaps]);

describe("layoutDay", () => {
  it("places events by time and leaves lone events full width", () => {
    const a = occ(t("09:00"), t("11:00"));
    const b = occ(t("13:00"), t("13:45"));
    expect(place([b, a])).toEqual([
      [a.event.title, 540, 120, 0, 1, false],
      [b.event.title, 780, 45, 0, 1, false],
    ]);
  });

  it("puts overlapping events side by side and marks them", () => {
    const a = occ(t("15:00"), t("17:00"));
    const b = occ(t("16:00"), t("18:00"));
    expect(place([a, b])).toEqual([
      [a.event.title, 900, 120, 0, 2, true],
      [b.event.title, 960, 120, 1, 2, true],
    ]);
  });

  it("back-to-back events do not overlap", () => {
    const a = occ(t("09:00"), t("10:00"));
    const b = occ(t("10:00"), t("11:00"));
    expect(place([a, b]).map((p) => p[5])).toEqual([false, false]);
  });

  it("chains: A overlaps B, B overlaps C, so all three share a cluster, and C reuses A's column", () => {
    const a = occ(t("09:00"), t("10:00"));
    const b = occ(t("09:30"), t("11:00"));
    const c = occ(t("10:15"), t("11:30"));
    expect(place([a, b, c])).toEqual([
      [a.event.title, 540, 60, 0, 2, true],
      [b.event.title, 570, 90, 1, 2, true],
      [c.event.title, 615, 75, 0, 2, true],
    ]);
  });

  it("three at once need three columns; a later lone event is separate", () => {
    const a = occ(t("09:00"), t("10:00"));
    const b = occ(t("09:00"), t("10:00"));
    const c = occ(t("09:30"), t("10:30"));
    const d = occ(t("12:00"), t("13:00"));
    const rows = layoutDay([a, b, c, d], DAY);
    expect(rows.filter((r) => r.occ !== d).map((r) => r.columns)).toEqual([3, 3, 3]);
    expect(new Set(rows.slice(0, 3).map((r) => r.column))).toEqual(new Set([0, 1, 2]));
    expect(rows.find((r) => r.occ === d)).toMatchObject({ columns: 1, overlaps: false });
  });

  it("gives very short events a minimum height", () => {
    expect(layoutDay([occ(t("09:00"), t("09:05"))], DAY)[0]!.height).toBe(20);
  });

  it("clips an event that runs past midnight to each day", () => {
    const late = occ("2026-11-07T22:00", "2026-11-08T01:00");
    expect(layoutDay([late], "2026-11-07")[0]).toMatchObject({ top: 1320, height: 120 });
    expect(layoutDay([late], "2026-11-08")[0]).toMatchObject({ top: 0, height: 60 });
  });

  it("leaves all-day and multi-day events to the all-day row", () => {
    const allDay = occ(DAY, DAY, true);
    const multi = occ("2026-11-06T10:00", "2026-11-08T10:00"); // two days long
    expect(isAllDayLike(allDay)).toBe(true);
    expect(isAllDayLike(multi)).toBe(true);
    expect(layoutDay([allDay, multi], DAY)).toEqual([]);
  });
});

describe("countOverlaps", () => {
  it("counts groups of overlapping events, not events", () => {
    const day = new Map([
      [DAY, [occ(t("09:00"), t("10:00")), occ(t("09:30"), t("10:30")), occ(t("14:00"), t("15:00")), occ(t("14:30"), t("15:30")), occ(t("18:00"), t("19:00"))]],
      ["2026-11-08", [occ("2026-11-08T09:00", "2026-11-08T10:00")]],
    ]);
    expect(countOverlaps(day)).toBe(2);
  });
});
