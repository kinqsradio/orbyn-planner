import { addDays, makeDue, parseDue } from "./dates";
import { newSeries, type Day, type Frequency, type Repeat, type Series } from "../store/repeat";
import type { FeedEvent } from "../store/types";

export class IcsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IcsError";
  }
}

interface Line {
  name: string;
  params: Record<string, string>;
  value: string;
}

/** RFC 5545 content lines: unfold continued lines, split name, parameters and value. */
function lines(text: string): Line[] {
  const out: Line[] = [];
  for (const raw of text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/)) {
    if (!raw.trim()) continue;
    // The value starts at the first colon outside a quoted parameter.
    let inQuote = false;
    let colon = -1;
    for (let i = 0; i < raw.length; i++) {
      if (raw[i] === '"') inQuote = !inQuote;
      else if (raw[i] === ":" && !inQuote) {
        colon = i;
        break;
      }
    }
    if (colon < 0) continue;
    const [name = "", ...rest] = raw.slice(0, colon).split(";");
    const params: Record<string, string> = {};
    for (const p of rest) {
      const eq = p.indexOf("=");
      if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, "");
    }
    out.push({ name: name.toUpperCase(), params, value: raw.slice(colon + 1) });
  }
  return out;
}

const unescapeText = (s: string) => s.replace(/\\([nN,;\\])/g, (_, c: string) => (c === "n" || c === "N" ? "\n" : c));

interface When {
  /** `YYYY-MM-DD` or `YYYY-MM-DDTHH:mm`, local. */
  value: string;
  allDay: boolean;
}

/** DATE and DATE-TIME values. A TZID is treated as local time; a trailing Z (UTC) is converted to local. */
function parseWhen(value: string, params: Record<string, string> = {}): When | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, , z] = m;
  if (h === undefined || params.VALUE === "DATE") return { value: `${y}-${mo}-${d}`, allDay: true };
  if (z) {
    const local = new Date(Date.UTC(+y!, +mo! - 1, +d!, +h, +mi!));
    return { value: makeDue(local, true), allDay: false };
  }
  return { value: `${y}-${mo}-${d}T${h}:${mi}`, allDay: false };
}

const BY_DAY: Record<string, Day> = { MO: "mon", TU: "tue", WE: "wed", TH: "thu", FR: "fri", SA: "sat", SU: "sun" };
const FREQ: Record<string, Frequency> = { DAILY: "daily", WEEKLY: "weekly", MONTHLY: "monthly", YEARLY: "yearly" };

/** The rule's basic parts: FREQ, INTERVAL, BYDAY (weekly), COUNT, UNTIL. Anything else makes the event a one-off. */
function parseRule(value: string): Repeat | null {
  const parts = Object.fromEntries(value.split(";").map((p) => p.split("=") as [string, string]));
  const frequency = FREQ[parts.FREQ ?? ""];
  if (!frequency) return null;
  const unsupported = ["BYMONTHDAY", "BYMONTH", "BYSETPOS", "BYYEARDAY", "BYWEEKNO", "BYHOUR", "BYMINUTE", "BYSECOND"];
  if (unsupported.some((k) => k in parts)) return null;
  const repeat: Repeat = { frequency, interval: Math.max(parseInt(parts.INTERVAL ?? "1", 10) || 1, 1), weekdays: [], end: { type: "never" } };
  if (parts.BYDAY) {
    if (frequency !== "weekly") return null;
    const days = parts.BYDAY.split(",").map((d) => BY_DAY[d]);
    if (days.some((d) => d === undefined)) return null; // "first Monday" style rules are not supported
    repeat.weekdays = days as Day[];
  }
  if (parts.COUNT) repeat.end = { type: "count", value: parseInt(parts.COUNT, 10) };
  else if (parts.UNTIL) {
    const until = parseWhen(parts.UNTIL);
    if (until) repeat.end = { type: "until", value: until.value.slice(0, 10) };
  }
  return repeat;
}

/** DURATION values like P1D, PT1H30M, P1W. */
function durationMinutes(value: string): number | null {
  const m = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value);
  if (!m) return null;
  const [, w, d, h, mi] = m.map((x) => (x === undefined ? 0 : Number(x))) as number[];
  return ((w ?? 0) * 7 + (d ?? 0)) * 1440 + (h ?? 0) * 60 + (mi ?? 0);
}

interface Raw {
  uid: string;
  recurrenceId: string | null;
  event: FeedEvent;
  skipped: string[];
}

function toEvent(props: Line[]): Raw | null {
  const get = (name: string) => props.find((p) => p.name === name);
  if (get("STATUS")?.value.toUpperCase() === "CANCELLED") return null;
  const dtstart = get("DTSTART");
  const start = dtstart && parseWhen(dtstart.value, dtstart.params);
  if (!dtstart || !start) return null;

  let end: string;
  const dtend = get("DTEND");
  const parsedEnd = dtend && parseWhen(dtend.value, dtend.params);
  const duration = get("DURATION") ? durationMinutes(get("DURATION")!.value) : null;
  if (start.allDay) {
    // An all-day DTEND is the day after the last day.
    const last = parsedEnd ? addDays(parseDue(parsedEnd.value.slice(0, 10)).date, -1) : null;
    const dayCount = duration !== null ? Math.max(Math.ceil(duration / 1440) - 1, 0) : 0;
    const fallback = addDays(parseDue(start.value).date, dayCount);
    const candidate = last ? makeDue(last, false) : makeDue(fallback, false);
    end = candidate < start.value ? start.value : candidate;
  } else if (parsedEnd) {
    end = parsedEnd.value.length === 10 ? `${parsedEnd.value}T00:00` : parsedEnd.value;
  } else if (duration !== null) {
    end = makeDue(new Date(parseDue(start.value).date.getTime() + duration * 60_000), true);
  } else {
    end = start.value;
  }
  if (!start.allDay && end < start.value) end = start.value;

  let series: Series | null = null;
  const rrule = get("RRULE");
  const skipped = props
    .filter((p) => p.name === "EXDATE")
    .flatMap((p) => p.value.split(",").map((v) => parseWhen(v, p.params)?.value.slice(0, 10)))
    .filter((d): d is string => Boolean(d));
  if (rrule) {
    const rule = parseRule(rrule.value);
    if (rule) {
      try {
        series = { ...newSeries(start.value.slice(0, 10), rule), skipped: [...new Set(skipped)].sort() };
      } catch {
        series = null;
      }
    }
  }

  const recurrence = get("RECURRENCE-ID");
  return {
    uid: get("UID")?.value ?? "",
    recurrenceId: recurrence ? (parseWhen(recurrence.value, recurrence.params)?.value.slice(0, 10) ?? null) : null,
    skipped,
    event: {
      title: unescapeText(get("SUMMARY")?.value ?? "").trim() || "(No title)",
      allDay: start.allDay,
      start: start.value,
      end,
      place: unescapeText(get("LOCATION")?.value ?? ""),
      notes: unescapeText(get("DESCRIPTION")?.value ?? ""),
      series,
    },
  };
}

/**
 * Reads the events of an iCalendar feed. Supports DTSTART, DTEND or DURATION, SUMMARY, LOCATION,
 * DESCRIPTION, all-day dates, UTC times (converted to local), TZID times (read as local), basic
 * RRULEs (FREQ, INTERVAL, BYDAY on weekly rules, COUNT, UNTIL), EXDATE and RECURRENCE-ID overrides.
 * A rule it cannot express leaves the event as a one-off on its first date.
 */
export function parseIcs(text: string): FeedEvent[] {
  const all = lines(text);
  if (!all.some((l) => l.name === "BEGIN" && l.value.toUpperCase() === "VCALENDAR")) {
    throw new IcsError("This is not a calendar feed");
  }
  const raws: Raw[] = [];
  let current: Line[] | null = null;
  for (const line of all) {
    if (line.name === "BEGIN" && line.value.toUpperCase() === "VEVENT") current = [];
    else if (line.name === "END" && line.value.toUpperCase() === "VEVENT") {
      const raw = current && toEvent(current);
      if (raw) raws.push(raw);
      current = null;
    } else if (current) current.push(line);
  }

  // An override replaces one date of its series: take that date out of the series.
  for (const o of raws.filter((r) => r.recurrenceId)) {
    const master = raws.find((r) => r.uid === o.uid && !r.recurrenceId && r.event.series);
    if (master?.event.series && !master.event.series.skipped.includes(o.recurrenceId!)) {
      master.event.series = { ...master.event.series, skipped: [...master.event.series.skipped, o.recurrenceId!].sort() };
    }
  }
  return raws.map((r) => r.event);
}

