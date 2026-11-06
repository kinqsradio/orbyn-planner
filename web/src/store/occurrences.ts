import { addWall, daysBetween, lastDayOf } from "../lib/wall";
import { wallToLocal } from "../lib/zones";
import { occurrences as seriesOccurrences } from "./repeat";
import type { CalendarEvent } from "./types";

/** One appearance of an event on the calendar: a single event, or one date of a series. */
export interface Occurrence {
  event: CalendarEvent;
  /** The date of this occurrence's start, `YYYY-MM-DD`. */
  date: string;
  /** `YYYY-MM-DDTHH:mm`, or `YYYY-MM-DD` for an all-day event. */
  start: string;
  end: string;
  allDay: boolean;
}

/** Moves an event's start and end to start on `date`, keeping its length and its times of day. */
export function shiftTo(event: Pick<CalendarEvent, "start" | "end" | "allDay">, date: string): { start: string; end: string } {
  const days = daysBetween(event.start, date);
  if (days === 0) return { start: event.start, end: event.end };
  return { start: addWall(event.start, days), end: addWall(event.end, days) };
}

const cache = new WeakMap<CalendarEvent, Map<string, Occurrence[]>>();

/** The occurrences of one repeating event in a range, remembered per event and range. */
function repeating(event: CalendarEvent, from: string, to: string): Occurrence[] {
  let ranges = cache.get(event);
  if (!ranges) cache.set(event, (ranges = new Map()));
  const key = `${from}|${to}`;
  const hit = ranges.get(key);
  if (hit) return hit;
  const length = Math.max(daysBetween(event.start, lastDayOf(event.start, event.end, event.allDay)), 0);
  const early = addWall(from, -length);
  const out: Occurrence[] = [];
  for (const date of seriesOccurrences(event.repeat!, early, to)) {
    const { start, end } = shiftTo(event, date);
    if (lastDayOf(start, end, event.allDay) >= from) out.push({ event, date, start, end, allDay: event.allDay });
  }
  if (ranges.size > 50) ranges.clear();
  ranges.set(key, out);
  return out;
}

/**
 * An event written in another time zone repeats at the same wall time there. Its dates are found in
 * that zone, a day either side of the range, and each is then converted to the viewer's time, so a
 * change of daylight saving in either place moves it correctly.
 */
function zoned(event: CalendarEvent, from: string, to: string): Occurrence[] {
  const zone = event.zone!;
  const out: Occurrence[] = [];
  const base = event.repeat
    ? seriesOccurrences(event.repeat, addWall(from, -2), addWall(to, 2)).map((date) => shiftTo(event, date))
    : [{ start: event.start, end: event.end }];
  for (const w of base) {
    const start = wallToLocal(zone, w.start) ?? w.start;
    const end = wallToLocal(zone, w.end) ?? w.end;
    if (start.slice(0, 10) <= to && lastDayOf(start, end, false) >= from) out.push({ event, date: start.slice(0, 10), start, end, allDay: false });
  }
  return out;
}

/** Every occurrence of the visible events that touches the days `from` to `to` (inclusive, `YYYY-MM-DD`), in start order. */
export function expandEvents(events: readonly CalendarEvent[], from: string, to: string): Occurrence[] {
  const out: Occurrence[] = [];
  for (const event of events) {
    if (event.deletedAt !== null) continue;
    if (event.zone && !event.allDay) {
      out.push(...zoned(event, from, to));
    } else if (event.repeat) {
      out.push(...repeating(event, from, to));
    } else if (event.start.slice(0, 10) <= to && lastDayOf(event.start, event.end, event.allDay) >= from) {
      out.push({ event, date: event.start.slice(0, 10), start: event.start, end: event.end, allDay: event.allDay });
    }
  }
  return out.sort((a, b) => a.start.localeCompare(b.start) || a.event.title.localeCompare(b.event.title));
}

const WEEKDAY_NAMES = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" } as const;

/** "Never", "Every day", "Every 2 weeks", "Every Tuesday", "Every Monday and Saturday". */
export function repeatLabel(series: CalendarEvent["repeat"]): string {
  if (!series) return "Never";
  const { frequency, interval, weekdays } = series.repeat;
  const unit = { daily: "day", weekly: "week", monthly: "month", yearly: "year" }[frequency];
  if (frequency === "weekly" && weekdays.length > 0 && interval === 1) {
    const names = weekdays.map((d) => WEEKDAY_NAMES[d]);
    return `Every ${names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0]}`;
  }
  return interval === 1 ? `Every ${unit}` : `Every ${interval} ${unit}s`;
}
