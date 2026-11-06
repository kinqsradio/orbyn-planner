import { addWall } from "../../lib/wall";
import type { Day, Repeat, Series } from "../../store/repeat";
import type { CalendarEvent, PlannerState, Priority, Response, Tag, Task } from "../../store/types";

const UID_HOST = "orbyn-planner";
const BYDAY: Record<Day, string> = { mon: "MO", tue: "TU", wed: "WE", thu: "TH", fri: "FR", sat: "SA", sun: "SU" };
const FREQ = { daily: "DAILY", weekly: "WEEKLY", monthly: "MONTHLY", yearly: "YEARLY" } as const;
const PRIORITY: Record<Priority, number | null> = { none: null, high: 1, medium: 5, low: 9 };
const PARTSTAT: Record<Response, string> = { accepted: "ACCEPTED", declined: "DECLINED", tentative: "TENTATIVE", none: "NEEDS-ACTION" };

/** TEXT values: backslash, semicolon, comma and line breaks are escaped (RFC 5545 §3.3.11). */
const text = (s: string) =>
  s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n?|\n/g, "\\n")
    // Other control characters have no place in a TEXT value and could break the line structure.
    // eslint-disable-next-line no-control-regex -- matching control characters is the point
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");

/** An address safe to put after `mailto:`: no whitespace, control characters or iCalendar delimiters. */
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const SAFE_EMAIL = /^[^\s\x00-\x1f\x7f;:,"<>\\]+@[^\s\x00-\x1f\x7f;:,"<>\\]+$/;

/** `YYYY-MM-DD` or `YYYY-MM-DDTHH:mm` as `YYYYMMDD` or `YYYYMMDDTHHMM00` (floating: the wall time as written). */
function when(value: string): { value: string; date: boolean } {
  const [d = "", t] = value.split("T");
  const day = d.replace(/-/g, "");
  return t === undefined ? { value: day, date: true } : { value: `${day}T${t.replace(":", "")}00`, date: false };
}

/** An ISO instant as UTC `YYYYMMDDTHHMMSSZ`. */
const utc = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/** A property line with its value type when it is a date alone. */
const dateProp = (name: string, w: { value: string; date: boolean }) => (w.date ? `${name};VALUE=DATE:${w.value}` : `${name}:${w.value}`);

/** RFC 5545 §3.1: lines folded at 75 octets, on a character boundary, continuation lines starting with a space. */
export function fold(line: string): string[] {
  const out: string[] = [];
  let current = "";
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const size = new TextEncoder().encode(ch).length;
    if (bytes + size > limit) {
      out.push(current);
      current = " ";
      bytes = 1;
      limit = 75;
    }
    current += ch;
    bytes += size;
  }
  out.push(current);
  return out;
}

function rrule(repeat: Repeat, dateOnly: boolean): string {
  const parts = [`FREQ=${FREQ[repeat.frequency]}`];
  if (repeat.interval > 1) parts.push(`INTERVAL=${repeat.interval}`);
  if (repeat.weekdays.length > 0) parts.push(`BYDAY=${repeat.weekdays.map((d) => BYDAY[d]).join(",")}`);
  if (repeat.end.type === "count") parts.push(`COUNT=${repeat.end.value}`);
  // "Until" is a date: the last day an occurrence may fall on, so a timed series runs to the end of that day.
  if (repeat.end.type === "until") parts.push(`UNTIL=${repeat.end.value.replace(/-/g, "")}${dateOnly ? "" : "T235959"}`);
  return `RRULE:${parts.join(";")}`;
}

/** The time of day an occurrence of a series has, taken from its first one. */
const atTime = (date: string, first: string) => (first.includes("T") ? `${date}T${first.split("T")[1]}` : date);

/** Date-only items remind at 09:00 that day, as the planner does, so the trigger counts from 09:00, not midnight. */
const DATE_ONLY_REMINDER = 9 * 60;

function alarm(minutes: number | null, dateOnly: boolean): string[] {
  if (minutes === null) return [];
  const offset = dateOnly ? DATE_ONLY_REMINDER - minutes : -minutes;
  const trigger = offset === 0 ? "PT0S" : offset > 0 ? `PT${offset}M` : `-PT${-offset}M`;
  return ["BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:Reminder", `TRIGGER:${trigger}`, "END:VALARM"];
}

function exdates(series: Series | null, first: string, keep: Set<string>): string[] {
  const dates = (series?.skipped ?? []).filter((d) => !keep.has(d)).map((d) => when(atTime(d, first)));
  return dates.map((w) => dateProp("EXDATE", w));
}

function vevent(e: CalendarEvent, stamp: string, all: readonly CalendarEvent[]): string[] {
  const start = when(e.start);
  // An all-day event's `end` is the last day it covers; iCalendar's DTEND is the day after.
  const end = e.allDay ? when(addWall(e.end, 1)) : when(e.end);
  const parent = e.overrideOf ? all.find((p) => p.id === e.overrideOf!.id) : undefined;
  const lines = ["BEGIN:VEVENT", `UID:${parent ? parent.id : e.id}@${UID_HOST}`, `DTSTAMP:${stamp}`];
  if (e.overrideOf) {
    // One occurrence of a repeating event, changed on its own: it replaces that date of the series.
    lines.push(dateProp("RECURRENCE-ID", when(atTime(e.overrideOf.date, parent?.start ?? e.start))));
  }
  lines.push(dateProp("DTSTART", start), dateProp("DTEND", end), `SUMMARY:${text(e.title)}`);
  if (e.place) lines.push(`LOCATION:${text(e.place)}`);
  if (e.notes) lines.push(`DESCRIPTION:${text(e.notes)}`);
  if (e.repeat) {
    lines.push(rrule(e.repeat.repeat, start.date));
    const overridden = new Set(all.filter((o) => o.overrideOf?.id === e.id && o.deletedAt === null).map((o) => o.overrideOf!.date));
    lines.push(...exdates(e.repeat, e.start, overridden));
  }
  for (const p of e.people) {
    // An address that could break the file is left out rather than written.
    if (SAFE_EMAIL.test(p.email)) lines.push(`ATTENDEE;PARTSTAT=${PARTSTAT[p.response]}:mailto:${p.email}`);
  }
  lines.push(...alarm(e.reminder, start.date), "END:VEVENT");
  return lines;
}

function vtodo(t: Task, listName: string, tagNames: string[], stamp: string): string[] {
  const due = when(t.due!);
  const lines = ["BEGIN:VTODO", `UID:${t.id}@${UID_HOST}`, `DTSTAMP:${stamp}`];
  // A repeating task's DTSTART is the series start; its DUE is the current occurrence.
  if (t.repeat) lines.push(dateProp("DTSTART", when(atTime(t.repeat.start, t.due!))));
  lines.push(dateProp("DUE", due), `SUMMARY:${text(t.title)}`);
  if (t.notes) lines.push(`DESCRIPTION:${text(t.notes)}`);
  // The list and the tags the task carries are its categories.
  const categories = [listName, ...tagNames].filter(Boolean);
  if (categories.length > 0) lines.push(`CATEGORIES:${categories.map(text).join(",")}`);
  const priority = PRIORITY[t.priority];
  if (priority !== null) lines.push(`PRIORITY:${priority}`);
  if (t.done) lines.push("STATUS:COMPLETED", ...(t.completedAt ? [`COMPLETED:${utc(t.completedAt)}`] : []));
  else lines.push("STATUS:NEEDS-ACTION");
  if (t.repeat) lines.push(rrule(t.repeat.repeat, due.date), ...exdates(t.repeat, t.due!, new Set()));
  lines.push(...alarm(t.reminder, due.date), "END:VTODO");
  return lines;
}

type Content = Pick<PlannerState, "lists" | "tasks" | "events" | "calendars"> & { tags?: readonly Tag[] };

/**
 * The events of the person's own calendars as VEVENT, and the tasks with a due date as VTODO, with repeat rules
 * as RRULE (and skipped dates as EXDATE). Deleted items are left out, and so are the events of subscribed
 * calendars, which are copies of someone else's feed. Times are floating: the wall time as the planner shows it.
 */
export function buildIcs(state: Content, now: Date): string {
  const stamp = utc(now.toISOString());
  const subscribed = new Set(state.calendars.filter((c) => c.kind.type === "subscribed").map((c) => c.id));
  const events = state.events.filter((e) => e.deletedAt === null && !e.readOnly && !subscribed.has(e.calendarId));
  const lists = new Map(state.lists.map((l) => [l.id, l.name] as const));
  const tags = new Map((state.tags ?? []).filter((g) => g.deletedAt === null).map((g) => [g.id, g.name] as const));
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Orbyn//Planner//EN", "CALSCALE:GREGORIAN"];
  for (const e of events) lines.push(...vevent(e, stamp, state.events));
  for (const t of state.tasks) if (t.deletedAt === null && t.due) lines.push(...vtodo(t, lists.get(t.listId) ?? "", t.tags.flatMap((id) => tags.get(id) ?? []), stamp));
  lines.push("END:VCALENDAR");
  return `${lines.flatMap(fold).join("\r\n")}\r\n`;
}
