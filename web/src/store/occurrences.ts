import { addDays, makeDue, parseDue } from "../lib/dates";
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

const dayDiff = (a: string, b: string): number =>
  Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) / 86_400_000);

/** Moves an event's start and end to start on `date`, keeping its length. */
export function shiftTo(event: Pick<CalendarEvent, "start" | "end" | "allDay">, date: string): { start: string; end: string } {
  const days = dayDiff(event.start.slice(0, 10), date);
  if (days === 0) return { start: event.start, end: event.end };
  const move = (value: string) => {
    const { date: d, hasTime } = parseDue(value);
    return makeDue(addDays(d, days), hasTime);
  };
  return { start: move(event.start), end: move(event.end) };
}

/** Every occurrence of the visible events that touches the days `from` to `to` (inclusive, `YYYY-MM-DD`), in start order. */
export function expandEvents(events: readonly CalendarEvent[], from: string, to: string): Occurrence[] {
  const out: Occurrence[] = [];
  for (const event of events) {
    if (event.deletedAt !== null) continue;
    const length = Math.max(dayDiff(event.start.slice(0, 10), event.end.slice(0, 10)), 0);
    const first = event.start.slice(0, 10);
    if (!event.repeat) {
      if (first <= to && event.end.slice(0, 10) >= from) {
        out.push({ event, date: first, start: event.start, end: event.end, allDay: event.allDay });
      }
      continue;
    }
    const early = makeDue(addDays(parseDue(from).date, -length), false);
    for (const date of seriesOccurrences(event.repeat, early, to)) {
      const { start, end } = shiftTo(event, date);
      if (end.slice(0, 10) >= from) out.push({ event, date, start, end, allDay: event.allDay });
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
