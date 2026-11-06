import { newSeries, type Day, type Frequency, type Repeat, type Series } from "../store/repeat";
import { addWall } from "./wall";
import { instantToWall, resolveZone, zonedInstant } from "./zones";
import type { FeedEvent } from "../store/types";

/** The most events one feed may hold, and the most bytes it may be, before it is refused. */
export const MAX_EVENTS = 5000;
export const MAX_FEED_BYTES = 5 * 1024 * 1024;

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
  /** `YYYY-MM-DD` or `YYYY-MM-DDTHH:mm`, as written in the feed: wall-clock time in `zone`. */
  value: string;
  allDay: boolean;
  /** The IANA zone the time is in ("UTC" for a trailing Z), or null for floating time. */
  zone: string | null;
}

/**
 * DATE and DATE-TIME values. A trailing Z is UTC; a TZID (an IANA name, or a common Windows one)
 * names the zone. The time stays as written, wall-clock in its zone, because a repeat keeps that
 * wall time on every date: converting to the viewer's zone is done per occurrence, so zones whose
 * daylight saving differs still land right. A TZID that is not known is floating local time, and
 * `notes` says so.
 */
function parseWhen(value: string, params: Record<string, string>, notes: Set<string>): When | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, , z] = m;
  if (h === undefined || params.VALUE === "DATE") return { value: `${y}-${mo}-${d}`, allDay: true, zone: null };
  const wall = `${y}-${mo}-${d}T${h}:${mi}`;
  if (z) return { value: wall, allDay: false, zone: "UTC" };
  if (params.TZID) {
    const zone = resolveZone(params.TZID);
    if (zone) return { value: wall, allDay: false, zone };
    notes.add(`The time zone “${params.TZID}” isn’t known here, so times are shown as written.`);
  }
  return { value: wall, allDay: false, zone: null };
}

/** The date of a value in the series' own zone: a UTC (Z) or other-zone moment is converted before its date is taken. */
function dayIn(when: When, zone: string | null): string {
  if (when.allDay || !when.zone || !zone || when.zone === zone) return when.value.slice(0, 10);
  const at = zonedInstant(when.zone, +when.value.slice(0, 4), +when.value.slice(5, 7), +when.value.slice(8, 10), +when.value.slice(11, 13), +when.value.slice(14, 16));
  return ((at && instantToWall(zone, at)) ?? when.value).slice(0, 10);
}

const BY_DAY: Record<string, Day> = { MO: "mon", TU: "tue", WE: "wed", TH: "thu", FR: "fri", SA: "sat", SU: "sun" };
const FREQ: Record<string, Frequency> = { DAILY: "daily", WEEKLY: "weekly", MONTHLY: "monthly", YEARLY: "yearly" };
const WHOLE = /^\d{1,10}$/;

/**
 * The rule's basic parts: FREQ, INTERVAL, BYDAY (weekly), COUNT, UNTIL. Anything else, or a number
 * that is not a whole number in the engine's range, makes the rule unsupported (null).
 */
function parseRule(value: string, notes: Set<string>, zone: string | null): Repeat | null {
  const parts = Object.fromEntries(value.split(";").map((p) => p.split("=") as [string, string]));
  const frequency = FREQ[parts.FREQ ?? ""];
  if (!frequency) return null;
  const unsupported = ["BYMONTHDAY", "BYMONTH", "BYSETPOS", "BYYEARDAY", "BYWEEKNO", "BYHOUR", "BYMINUTE", "BYSECOND", "BYEASTER", "WKST"];
  if (unsupported.some((k) => k in parts && !(k === "WKST" && parts[k] === "MO"))) return null;
  let interval = 1;
  if (parts.INTERVAL !== undefined) {
    if (!WHOLE.test(parts.INTERVAL)) return null;
    interval = Number(parts.INTERVAL);
    if (interval < 1 || interval > 65535) return null;
  }
  const repeat: Repeat = { frequency, interval, weekdays: [], end: { type: "never" } };
  if (parts.BYDAY) {
    if (frequency !== "weekly") return null;
    const days = parts.BYDAY.split(",").map((d) => BY_DAY[d]);
    if (days.some((d) => d === undefined)) return null; // "first Monday" style rules are not supported
    repeat.weekdays = days as Day[];
  }
  if (parts.COUNT !== undefined) {
    if (!WHOLE.test(parts.COUNT)) return null;
    const count = Number(parts.COUNT);
    if (count < 1 || count > 4294967295) return null;
    repeat.end = { type: "count", value: count };
  } else if (parts.UNTIL !== undefined) {
    const until = parseWhen(parts.UNTIL, {}, notes);
    if (!until) return null;
    repeat.end = { type: "until", value: dayIn(until, zone) };
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
  cancelled: boolean;
  event: FeedEvent;
}

/** Added to the notes of an event whose repeat cannot be shown; the Calendars dialog lists these. */
export const NOT_SUPPORTED = "Repeat not supported: only its first date is shown.";

function toEvent(props: Line[]): Raw | null {
  const get = (name: string) => props.find((p) => p.name === name);
  const notes = new Set<string>();
  const cancelled = get("STATUS")?.value.toUpperCase() === "CANCELLED";
  const dtstart = get("DTSTART");
  const start = dtstart && parseWhen(dtstart.value, dtstart.params, notes);
  if (!dtstart || !start) return null;

  const startValue = start.value;
  let end: string;
  const dtend = get("DTEND");
  const parsedEnd = dtend && parseWhen(dtend.value, dtend.params, notes);
  const duration = get("DURATION") ? durationMinutes(get("DURATION")!.value) : null;
  if (start.allDay) {
    // An all-day DTEND is the day after the last day.
    const last = parsedEnd ? addWall(parsedEnd.value.slice(0, 10), -1) : addWall(start.value, duration !== null ? Math.max(Math.ceil(duration / 1440) - 1, 0) : 0);
    end = last < start.value ? start.value : last;
  } else if (parsedEnd) {
    let wall = parsedEnd.value.length === 10 ? `${parsedEnd.value}T00:00` : parsedEnd.value;
    // An end in another zone than the start becomes the same moment in the start's zone.
    if (start.zone && parsedEnd.zone && parsedEnd.zone !== start.zone) {
      const at = zonedInstant(parsedEnd.zone, +wall.slice(0, 4), +wall.slice(5, 7), +wall.slice(8, 10), +wall.slice(11, 13), +wall.slice(14, 16));
      wall = (at && instantToWall(start.zone, at)) ?? wall;
    }
    end = wall;
  } else if (duration !== null) {
    end = addWall(start.value, 0, duration);
  } else {
    end = start.value;
  }
  if (!start.allDay && end < startValue) end = startValue;

  let series: Series | null = null;
  const seriesZone = start.allDay ? null : start.zone;
  const rrule = get("RRULE");
  const skipped = props
    .filter((p) => p.name === "EXDATE")
    .flatMap((p) => p.value.split(",").map((v) => { const w = parseWhen(v, p.params, notes); return w ? dayIn(w, seriesZone) : undefined; }))
    .filter((d): d is string => Boolean(d));
  if (rrule) {
    const rule = parseRule(rrule.value, notes, seriesZone);
    let ok = false;
    if (rule) {
      try {
        series = { ...newSeries(startValue.slice(0, 10), rule), skipped: [...new Set(skipped)].sort() };
        ok = true;
      } catch {
        series = null;
      }
    }
    // A rule it cannot say is never guessed at: only the first date is shown.
    if (!ok) notes.add(NOT_SUPPORTED);
  }

  const recurrence = get("RECURRENCE-ID");
  const description = unescapeText(get("DESCRIPTION")?.value ?? "");
  return {
    uid: get("UID")?.value ?? "",
    recurrenceId: recurrence ? (() => { const w = parseWhen(recurrence.value, recurrence.params, notes); return w ? dayIn(w, seriesZone) : null; })() : null,
    cancelled,
    event: {
      title: unescapeText(get("SUMMARY")?.value ?? "").trim() || "(No title)",
      allDay: start.allDay,
      start: startValue,
      end,
      zone: start.allDay ? null : start.zone,
      place: unescapeText(get("LOCATION")?.value ?? ""),
      notes: [description, ...notes].filter(Boolean).join("\n\n"),
      series,
    },
  };
}

/**
 * Reads the events of an iCalendar feed. Supports DTSTART, DTEND or DURATION, SUMMARY, LOCATION,
 * DESCRIPTION, all-day dates, UTC times and TZID times (IANA and common Windows names), converted
 * to the viewer's time, basic RRULEs (FREQ, INTERVAL, BYDAY on weekly rules, COUNT, UNTIL), EXDATE,
 * and RECURRENCE-ID overrides, cancelled ones included. A rule it cannot express leaves a read-only
 * event on its first date only, with a "Repeat not supported" note; no dates are guessed. Nested components such as VALARM are
 * ignored. A feed with more than MAX_EVENTS events is refused.
 */
export function parseIcs(text: string): FeedEvent[] {
  const all = lines(text);
  if (!all.some((l) => l.name === "BEGIN" && l.value.toUpperCase() === "VCALENDAR")) {
    throw new IcsError("This is not a calendar feed");
  }
  const raws: Raw[] = [];
  let current: Line[] | null = null;
  let nested = 0;
  let seen = 0;
  for (const line of all) {
    const kind = line.value.toUpperCase();
    if (current === null) {
      if (line.name === "BEGIN" && kind === "VEVENT") {
        if (++seen > MAX_EVENTS) throw new IcsError(`This calendar has more than ${MAX_EVENTS} events`);
        current = [];
      }
    } else if (nested > 0) {
      // Inside a VALARM or another component of the event: its lines are not the event's.
      if (line.name === "BEGIN") nested += 1;
      else if (line.name === "END") nested -= 1;
    } else if (line.name === "BEGIN") {
      nested = 1;
    } else if (line.name === "END" && kind === "VEVENT") {
      const raw = toEvent(current);
      if (raw) raws.push(raw);
      current = null;
    } else {
      current.push(line);
    }
  }

  // An override replaces one date of its series: take that date out of the series. A cancelled
  // override only does that; it adds no event.
  const events: FeedEvent[] = [];
  for (const o of raws) {
    if (o.recurrenceId) {
      const master = raws.find((r) => r.uid === o.uid && !r.recurrenceId && r.event.series);
      if (master?.event.series && !master.event.series.skipped.includes(o.recurrenceId)) {
        master.event.series = { ...master.event.series, skipped: [...master.event.series.skipped, o.recurrenceId].sort() };
      }
    }
  }
  for (const r of raws) if (!r.cancelled) events.push(r.event);
  return events;
}
