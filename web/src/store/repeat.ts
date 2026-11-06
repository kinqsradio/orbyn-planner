/**
 * Repeat rules, in the spirit of iCalendar RRULE but only the parts people use: every N days,
 * weeks (on chosen weekdays), months or years, ending never, on a date, or after a number of times.
 *
 * A TypeScript port of orbyn-engine's `orbyn-planner` repeat.rs, with the same names and rules.
 * Until the Rust code arrives through WebAssembly, keep the two in step; repeat.test.ts ports the
 * Rust tests one to one. Dates are `YYYY-MM-DD` strings, so string order is date order.
 *
 * Rules a port must match exactly (the same list is in repeat.rs):
 *
 * - Repeats work on dates. A timed task or event repeats at the same local wall time on each date.
 * - Weeks start on Monday (ISO 8601). "Every 2 weeks on Monday and Sunday" counts in Monday-to-Sunday
 *   weeks from the week containing the start.
 * - The start is the first date the series *may* fall on. Unlike RFC 5545's DTSTART, a start that
 *   does not match the rule (a Saturday start for "every Monday") is not itself an occurrence.
 * - A monthly rule on the 31st skips months without a 31st, and a yearly rule on 29 February repeats
 *   only in leap years, as RFC 5545 does. Skipped months do not count towards a count end.
 * - An until date is inclusive.
 * - One query returns at most MAX_OCCURRENCES dates, and a walk looks at most MAX_STEPS periods from
 *   the start (about 500 years of a daily rule), after which the series has no more occurrences.
 * - Skipping a date that is already skipped changes nothing.
 * - A split at the first occurrence is refused (SplitAtFirst): edit the whole series instead.
 */

/** The most occurrences one call returns, so a bad range cannot run away. */
export const MAX_OCCURRENCES = 1000;
/** The most periods a walk looks at before giving up. */
export const MAX_STEPS = 200_000;

export type Frequency = "daily" | "weekly" | "monthly" | "yearly";
/** A day of the week, stored as "mon" … "sun". */
export type Day = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
export const DAYS: readonly Day[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

export type End =
  | { type: "never" }
  /** The last date an occurrence may fall on. */
  | { type: "until"; value: string }
  /** The number of occurrences, counting the first. */
  | { type: "count"; value: number };

export interface Repeat {
  frequency: Frequency;
  /** Every `interval` periods; at least 1. */
  interval: number;
  /** For weekly rules: the weekdays it falls on. Empty means the start's weekday. */
  weekdays: Day[];
  end: End;
}

/** A repeating task or event: its first date, its rule, and dates removed with "this one only". */
export interface Series {
  start: string;
  repeat: Repeat;
  skipped: string[];
}

export type RepeatErrorCode =
  | "ZeroInterval"
  | "ZeroCount"
  | "EndsBeforeStart"
  | "WeekdaysNotWeekly"
  | "NotAnOccurrence"
  | "SplitAtFirst"
  /** The interval is not a whole number from 1 to 65535, the range the engine accepts. */
  | "IntervalOutOfRange"
  /** The count is not a whole number from 1 to 4294967295. */
  | "CountOutOfRange";

const MESSAGES: Record<RepeatErrorCode, string> = {
  ZeroInterval: "repeat every 1 or more",
  ZeroCount: "a repeat can end after 1 or more times",
  EndsBeforeStart: "a repeat cannot end before it starts",
  WeekdaysNotWeekly: "weekdays only apply to weekly repeats",
  NotAnOccurrence: "that date is not part of this repeat",
  SplitAtFirst: "this is the first time it repeats: edit the whole series instead",
  IntervalOutOfRange: "repeat every 1 to 65535",
  CountOutOfRange: "a repeat can end after 1 to 4294967295 times",
};

export class RepeatError extends Error {
  constructor(readonly code: RepeatErrorCode) {
    super(MESSAGES[code]);
    this.name = "RepeatError";
  }
}

// Dates as day numbers since 1970-01-01, which makes day arithmetic exact.
const DAY_MS = 86_400_000;
const parse = (date: string): { y: number; m: number; d: number } => {
  const [y = 1970, m = 1, d = 1] = date.split("-").map(Number);
  return { y, m, d };
};
/** Days since 1970-01-01. Years 0 to 99 would be read as 1900 to 1999 by Date.UTC, so the year is set separately. */
const toDays = (date: string): number => {
  const { y, m, d } = parse(date);
  const t = new Date(0);
  t.setUTCFullYear(y, m - 1, d);
  return Math.round(t.getTime() / DAY_MS);
};
const pad = (n: number, width: number) => String(n).padStart(width, "0");
const format = (y: number, m: number, d: number) => `${pad(y, 4)}-${pad(m, 2)}-${pad(d, 2)}`;
/** Null when the result leaves jiff's range of years, as the Rust code does. */
const fromDays = (days: number): string | null => {
  const t = new Date(days * DAY_MS);
  const y = t.getUTCFullYear();
  if (y < -9999 || y > 9999) return null;
  return format(y, t.getUTCMonth() + 1, t.getUTCDate());
};
const addDays = (date: string, days: number): string | null => fromDays(toDays(date) + days);
/** 0 for Monday … 6 for Sunday. */
const mondayZeroOffset = (date: string): number => (new Date(toDays(date) * DAY_MS).getUTCDay() + 6) % 7;
export const dayOf = (date: string): Day => DAYS[mondayZeroOffset(date)]!;

/** The date when the day exists, null when that month lacks it, undefined when the year is out of range. */
function onDay(year: number, month: number, day: number): string | null | undefined {
  if (year < -9999 || year > 9999) return undefined;
  const t = new Date(0);
  t.setUTCFullYear(year, month - 1, day);
  if (t.getUTCMonth() !== month - 1 || t.getUTCDate() !== day) return null;
  return format(year, month, day);
}

/** `Repeat::every`: every period, never ending. */
export function repeatEvery(frequency: Frequency): Repeat {
  return { frequency, interval: 1, weekdays: [], end: { type: "never" } };
}

export function validate(series: Series): void {
  const r = series.repeat;
  if (r.interval === 0) throw new RepeatError("ZeroInterval");
  if (!Number.isInteger(r.interval) || r.interval < 1 || r.interval > 65535) throw new RepeatError("IntervalOutOfRange");
  if (r.weekdays.length > 0 && r.frequency !== "weekly") throw new RepeatError("WeekdaysNotWeekly");
  if (r.end.type === "count" && r.end.value === 0) throw new RepeatError("ZeroCount");
  if (r.end.type === "count" && (!Number.isInteger(r.end.value) || r.end.value < 1 || r.end.value > 4294967295)) throw new RepeatError("CountOutOfRange");
  if (r.end.type === "until" && r.end.value < series.start) throw new RepeatError("EndsBeforeStart");
}

/** `Series::new`: a valid series, or a RepeatError. */
export function newSeries(start: string, repeat: Repeat): Series {
  const series: Series = { start, repeat, skipped: [] };
  validate(series);
  return series;
}

/** Where a walk may begin: the period to start at, and how many occurrences the earlier periods gave. */
interface Plan {
  step: number;
  emitted: number;
}

/**
 * A safe place to start a walk that only wants dates from `from` on: a period or more before the
 * first date at or after it, with the number of occurrences the skipped periods would have emitted
 * (needed only for a count end). The walk then gives the same dates as one from the start.
 */
function planFrom(series: Series, from: string): Plan {
  const r = series.repeat;
  const interval = Math.max(r.interval, 1);
  const start = series.start;
  const counted = r.end.type === "count";
  const none: Plan = { step: 0, emitted: 0 };
  if (from <= start) return none;
  const { y: sy, m: sm, d: sd } = parse(start);
  const { y: fy, m: fm } = parse(from);
  switch (r.frequency) {
    case "daily": {
      const step = Math.max(0, Math.floor((toDays(from) - toDays(start)) / interval) - 1);
      return { step, emitted: step };
    }
    case "weekly": {
      const monday = toDays(start) - mondayZeroOffset(start);
      const weeks = Math.floor((toDays(from) - monday) / 7);
      const step = Math.max(0, Math.floor(weeks / interval) - 1);
      if (step === 0) return none;
      const offsets = [...new Set(r.weekdays.length === 0 ? [mondayZeroOffset(start)] : r.weekdays.map((w) => DAYS.indexOf(w)))];
      const firstWeek = offsets.filter((o) => monday + o >= toDays(start)).length;
      return { step, emitted: firstWeek + (step - 1) * offsets.length };
    }
    case "monthly": {
      // A whole year or more is skipped; the months of that run are counted when a count end needs them.
      const months = (fy - sy) * 12 + (fm - sm);
      const step = Math.max(0, Math.floor(months / interval) - 13);
      let emitted = 0;
      if (counted) {
        for (let i = 0; i < step; i++) {
          const total = sm - 1 + i * interval;
          if (onDay(sy + Math.floor(total / 12), (((total % 12) + 12) % 12) + 1, sd)) emitted += 1;
        }
      }
      return { step, emitted };
    }
    case "yearly": {
      const step = Math.max(0, Math.floor((fy - sy) / interval) - 1);
      let emitted = 0;
      if (counted) for (let i = 0; i < step; i++) if (onDay(sy + i * interval, sm, sd)) emitted += 1;
      return { step, emitted };
    }
  }
}

/** Calls `visit` with each occurrence in order, ignoring skips, until it returns false or the rule ends. */
function walk(series: Series, visit: (date: string) => boolean, plan: Plan = { step: 0, emitted: 0 }): void {
  const r = series.repeat;
  const interval = Math.max(r.interval, 1);
  let emitted = plan.emitted;
  const emit = (date: string): boolean => {
    if (r.end.type === "until" && date > r.end.value) return false;
    if (r.end.type === "count" && emitted >= r.end.value) return false;
    emitted += 1;
    return visit(date);
  };
  const start = series.start;
  const { y: startYear, m: startMonth, d: startDay } = parse(start);

  for (let step = plan.step; step < MAX_STEPS; step++) {
    const n = step * interval;
    let keepGoing: boolean;
    switch (r.frequency) {
      case "daily": {
        const d = addDays(start, n);
        keepGoing = d === null ? false : emit(d);
        break;
      }
      case "weekly": {
        const monday = addDays(start, -mondayZeroOffset(start));
        if (monday === null) return;
        const days =
          r.weekdays.length === 0
            ? [mondayZeroOffset(start)]
            : r.weekdays.map((w) => DAYS.indexOf(w));
        const sorted = [...new Set(days)].sort((a, b) => a - b);
        let go = true;
        for (const offset of sorted) {
          const d = addDays(monday, n * 7 + offset);
          if (d === null) return;
          if (d < start) continue;
          if (!emit(d)) {
            go = false;
            break;
          }
        }
        keepGoing = go;
        break;
      }
      case "monthly": {
        const months = startMonth - 1 + n;
        const year = startYear + Math.floor(months / 12);
        const month = (((months % 12) + 12) % 12) + 1;
        const d = onDay(year, month, startDay);
        keepGoing = d === undefined ? false : d === null ? true : emit(d);
        break;
      }
      case "yearly": {
        const d = onDay(startYear + n, startMonth, startDay);
        keepGoing = d === undefined ? false : d === null ? true : emit(d);
        break;
      }
    }
    if (!keepGoing) return;
  }
}

const isSkipped = (series: Series, date: string) => series.skipped.includes(date);

/** Every occurrence from `from` to `to`, both included, skipping removed dates, at most MAX_OCCURRENCES. */
export function occurrences(series: Series, from: string, to: string): string[] {
  return occurrencesWith(series, from, to, true);
}

/** `occurrences`, with the jump to the range's start switched on or off (tests compare the two). */
export function occurrencesWith(series: Series, from: string, to: string, jump: boolean): string[] {
  const out: string[] = [];
  walk(
    series,
    (date) => {
      if (date > to) return false;
      if (date >= from && !isSkipped(series, date)) out.push(date);
      return out.length < MAX_OCCURRENCES;
    },
    jump ? planFrom(series, from) : undefined,
  );
  return out;
}

/** The first occurrence on or after `date`. */
export function nextOnOrAfter(series: Series, date: string): string | null {
  let found: string | null = null;
  walk(series, (d) => {
    if (d >= date && !isSkipped(series, d)) {
      found = d;
      return false;
    }
    return true;
  }, planFrom(series, date));
  return found;
}

export function isOccurrence(series: Series, date: string): boolean {
  return nextOnOrAfter(series, date) === date;
}

/** "This one only": removes one date from the series. Skipping a skipped date changes nothing. Returns the changed series. */
export function skip(series: Series, date: string): Series {
  if (series.skipped.includes(date)) return series;
  if (!isOccurrence(series, date)) throw new RepeatError("NotAnOccurrence");
  return { ...series, skipped: [...new Set([...series.skipped, date])].sort() };
}

/** The first date the rule falls on, counting skipped ones; null for a series with none. */
export function firstOccurrence(series: Series): string | null {
  let first: string | null = null;
  walk(series, (d) => {
    first = d;
    return false;
  });
  return first;
}

/** Occurrences before `at`, counting skipped ones, as a count end does. */
function rawCountBefore(series: Series, at: string): number {
  let n = 0;
  walk(series, (d) => {
    if (d >= at) return false;
    n += 1;
    return true;
  });
  return n;
}

/**
 * "This and following": ends the series the day before `at` and returns it with a new series
 * starting at `at` with the same rule, as `[first, following]`. A count is shared out, so the two
 * together repeat the same number of times as before.
 */
export function splitAt(series: Series, at: string): [Series, Series] {
  if (!isOccurrence(series, at)) throw new RepeatError("NotAnOccurrence");
  const before = rawCountBefore(series, at);
  if (before === 0) throw new RepeatError("SplitAtFirst");
  const first: Series = { ...series, repeat: { ...series.repeat }, skipped: series.skipped.filter((d) => d < at) };
  const following: Series = {
    start: at,
    repeat: { ...series.repeat, weekdays: [...series.repeat.weekdays] },
    skipped: series.skipped.filter((d) => d >= at),
  };
  const end = series.repeat.end;
  if (end.type === "count") {
    first.repeat.end = { type: "count", value: before };
    following.repeat.end = { type: "count", value: Math.max(Math.max(end.value - before, 0), 1) };
  } else {
    const dayBefore = addDays(at, -1);
    if (dayBefore === null) throw new RepeatError("NotAnOccurrence");
    first.repeat.end = { type: "until", value: dayBefore };
  }
  if (following.repeat.frequency === "weekly" && following.repeat.weekdays.length === 0) {
    // Keep the weekdays explicit so the new start's weekday does not change them.
    following.repeat.weekdays = [dayOf(series.start)];
  }
  return [first, following];
}

/** How many occurrences fall before `at`, counting skipped ones, as a count end does. */
export function countBefore(series: Series, at: string): number {
  return rawCountBefore(series, at);
}
