import { addWall } from "../lib/wall";
import { firstOccurrence, type Repeat, type Series } from "./repeat";
import type { CalendarEvent } from "./types";

/**
 * How an event is stored, against how the app uses it. The app uses `repeat` as the engine's
 * Series, skipped dates and all. Storage and the outbox hold the rule as one field,
 * `repeat: { start, repeat }`, and each skipped date as a field of its own, `repeat.skip.<date>`
 * (true, or false once unskipped), as the engine's records do. Writes are per field, so two devices
 * that skip different dates keep both.
 */
export const SKIP_PREFIX = "repeat.skip.";

type Fields = Record<string, unknown>;

interface StoredRule {
  start: string;
  repeat: Repeat;
}

/** The record to write for a new event. */
export function toStored(event: CalendarEvent): Fields {
  const { repeat, ...rest } = event;
  const out: Fields = { ...rest, repeat: repeat ? ({ start: repeat.start, repeat: repeat.repeat } satisfies StoredRule) : null };
  for (const d of repeat?.skipped ?? []) out[SKIP_PREFIX + d] = true;
  return out;
}

/**
 * An event as the app reads it. A repeating event's first date and its series start can disagree
 * after devices edit at once; they are brought together, rolling forward as the engine does: the
 * series never starts before the event, and an event that no longer falls on its rule moves to the
 * next date that does, keeping its time of day.
 */
export function toView(stored: Fields): CalendarEvent {
  const skipped: string[] = [];
  const rest: Fields = {};
  for (const [k, v] of Object.entries(stored)) {
    if (k.startsWith(SKIP_PREFIX)) {
      if (v === true) skipped.push(k.slice(SKIP_PREFIX.length));
    } else rest[k] = v;
  }
  const rule = rest.repeat as StoredRule | null | undefined;
  const event = { overrideOf: null, zone: null, ...rest, repeat: null } as unknown as CalendarEvent;
  if (!rule) return event;
  return rollIntoSeries({ ...event, repeat: { start: rule.start, repeat: rule.repeat, skipped: skipped.sort() } });
}

function rollIntoSeries(event: CalendarEvent): CalendarEvent {
  const series = event.repeat!;
  const day = event.start.slice(0, 10);
  let start = series.start;
  if (start < day) start = day;
  let next: CalendarEvent = start === series.start ? event : { ...event, repeat: { ...series, start } };
  // The rule alone decides where the event sits; a skipped date is still a date of the rule.
  const first = firstOccurrence(next.repeat!);
  if (first !== null && first !== day) {
    const days = Math.round((Date.parse(first) - Date.parse(day)) / 86_400_000);
    next = { ...next, start: addWall(next.start, days), end: addWall(next.end, days) };
  }
  return next;
}

/** The fields that turn one series into another: the rule if it changed, and one field per skip added or removed. */
export function repeatFields(current: Series | null, next: Series | null): Fields {
  const out: Fields = {};
  const same =
    current && next && current.start === next.start && JSON.stringify(current.repeat) === JSON.stringify(next.repeat);
  if (!same) out.repeat = next ? ({ start: next.start, repeat: next.repeat } satisfies StoredRule) : null;
  const before = new Set(current?.skipped ?? []);
  const after = new Set(next?.skipped ?? []);
  for (const d of after) if (!before.has(d)) out[SKIP_PREFIX + d] = true;
  for (const d of before) if (!after.has(d)) out[SKIP_PREFIX + d] = false;
  return out;
}

/** Applies a stored-shape patch to an event as the app holds it, as storage will apply it. */
export function applyEventFields(event: CalendarEvent, fields: Fields): CalendarEvent {
  let next: CalendarEvent = { ...event };
  if ("repeat" in fields) {
    const rule = fields.repeat as StoredRule | null;
    next.repeat = rule ? { start: rule.start, repeat: rule.repeat, skipped: next.repeat?.skipped ?? [] } : null;
  }
  for (const [k, v] of Object.entries(fields)) {
    if (k === "repeat") continue;
    if (k.startsWith(SKIP_PREFIX)) {
      if (!next.repeat) continue;
      const date = k.slice(SKIP_PREFIX.length);
      const rest = next.repeat.skipped.filter((d) => d !== date);
      next = { ...next, repeat: { ...next.repeat, skipped: v === true ? [...rest, date].sort() : rest } };
    } else {
      (next as unknown as Fields)[k] = v;
    }
  }
  return next.repeat ? rollIntoSeries(next) : next;
}
