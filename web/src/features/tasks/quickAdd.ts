import { MONTHS, addDays, formatDueLong, makeDue, startOfDay, startOfWeek } from "../../lib/dates";
import { DAYS, type Day, type Frequency, type Repeat } from "../../store/repeat";
import type { Priority } from "../../store/types";

export interface QuickAddResult {
  title: string;
  /** `YYYY-MM-DD` or `YYYY-MM-DDTHH:mm`, or null when no date or time was written. */
  due: string | null;
  /** The matched list, or null to leave the task in the Inbox. */
  listId: string | null;
  priority: Priority;
  /** From "every fri", "every day", "every 2 weeks"…; the task then starts on its due date. */
  repeat: Repeat | null;
}

// Maps, so a word like "constructor" is only ever a word.
const PRIORITY_WORDS = new Map<string, Priority>([
  ["high", "high"], ["h", "high"], ["3", "high"],
  ["medium", "medium"], ["med", "medium"], ["m", "medium"], ["2", "medium"],
  ["low", "low"], ["l", "low"], ["1", "low"],
  ["none", "none"],
]);

const FULL_WEEKDAYS = new Map<string, number>([
  ["sunday", 0], ["monday", 1], ["tuesday", 2], ["wednesday", 3], ["thursday", 4], ["friday", 5], ["saturday", 6],
]);
/** Short forms are also ordinary words (sun hat, sat nav), so they need a hint that a date is meant. */
const SHORT_WEEKDAYS = new Map<string, number>([
  ["sun", 0], ["mon", 1], ["tue", 2], ["tues", 2], ["wed", 3], ["thu", 4], ["thur", 4], ["thurs", 4], ["fri", 5], ["sat", 6],
]);

const MONTH_NAMES = new Map<string, number>();
MONTHS.forEach((name, i) => {
  MONTH_NAMES.set(name.toLowerCase(), i);
  MONTH_NAMES.set(name.slice(0, 3).toLowerCase(), i);
});
MONTH_NAMES.set("sept", 8);

/** Words that say the next word is a date: "dentist on sat", "pay rent by 1 may". */
const DATE_HINTS = new Set(["on", "due", "by"]);
const DROPPED_HINTS = DATE_HINTS;

const UNITS = new Map<string, Frequency>([
  ["day", "daily"], ["days", "daily"], ["week", "weekly"], ["weeks", "weekly"],
  ["month", "monthly"], ["months", "monthly"], ["year", "yearly"], ["years", "yearly"],
]);
const WEEKDAY_SET: Day[] = ["mon", "tue", "wed", "thu", "fri"];

/**
 * "every fri", "every weekday", "every day", "every week", "every 2 weeks", "every other month":
 * the rule and how many tokens it used (counting "every"). Anything else after "every" is no repeat.
 */
function parseEvery(lower: string[], i: number): { repeat: Repeat; used: number; weekday?: number } | null {
  const a = lower[i + 1];
  if (a === undefined) return null;
  const rule = (frequency: Frequency, interval = 1, weekdays: Day[] = []): Repeat => ({ frequency, interval, weekdays, end: { type: "never" } });
  const wd = FULL_WEEKDAYS.get(a) ?? SHORT_WEEKDAYS.get(a);
  if (wd !== undefined) {
    return { repeat: rule("weekly", 1, [DAYS[(wd + 6) % 7]!]), used: 2, weekday: wd };
  }
  if (a === "weekday" || a === "weekdays") return { repeat: rule("weekly", 1, WEEKDAY_SET), used: 2 };
  const unit = UNITS.get(a);
  if (unit && !a.endsWith("s")) return { repeat: rule(unit), used: 2 };
  if (a === "other" && UNITS.has(lower[i + 2] ?? "")) return { repeat: rule(UNITS.get(lower[i + 2]!)!, 2), used: 3 };
  const n = /^\d{1,3}$/.test(a) ? parseInt(a, 10) : 0;
  if (n >= 1 && UNITS.has(lower[i + 2] ?? "")) return { repeat: rule(UNITS.get(lower[i + 2]!)!, n), used: 3 };
  return null;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "");
const DAY_NUMBER = /^\d{1,2}(st|nd|rd|th)?$/;

function parseTime(token: string): { h: number; m: number } | null {
  const match = /^(\d{1,2})(?::(\d{2}))?(am|pm)?$/.exec(token.toLowerCase());
  if (!match) return null;
  const [, hs, ms, ap] = match;
  // A bare number is not a time; it needs a colon or am/pm.
  if (!ms && !ap) return null;
  let h = Number(hs);
  const m = ms ? Number(ms) : 0;
  if (m > 59) return null;
  if (ap) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (ap === "pm" ? 12 : 0);
  } else if (h > 23) return null;
  return { h, m };
}

/** The next date for a day and month: this year or one of the next four, so 29 February finds a leap year. */
function nextDate(day: number, month: number, now: Date): Date | null {
  for (let year = now.getFullYear(); year <= now.getFullYear() + 4; year++) {
    const d = new Date(year, month, day);
    if (d.getMonth() === month && d.getDate() === day && d.getTime() >= startOfDay(now).getTime()) return d;
  }
  return null;
}

const isAcronym = (token: string) => token.length > 1 && /^[A-Z]+$/.test(token);

/**
 * Reads plain words from a quick-add line: a day (today, tomorrow, a weekday, "next week",
 * "14 nov", 2026-11-14), a time (3pm, 15:00), `#list` and `!priority`. Everything else is the title.
 *
 * Ordinary words are left alone: a short weekday or a month (sun, sat, mar, may) counts only at
 * the end of the text, ignoring a time, list or priority after it, or after "on", "due", "by" or
 * "every". Full weekday names, today, tomorrow, "next week" and ISO dates count anywhere. An ALL CAPS
 * word (SAT, MAY) is never a date.
 *
 * A weekday means its next occurrence after today; "next friday" is that day in the following
 * Monday to Sunday week. A time with no day means today, or tomorrow once it has passed.
 */
export function parseQuickAdd(
  text: string,
  now: Date,
  lists: readonly { id: string; name: string }[],
): QuickAddResult {
  const raw = text.trim().replace(/\s+/g, " ");
  const tokens = raw === "" ? [] : raw.split(" ");
  const lower = tokens.map((t) => t.toLowerCase());
  const keep: boolean[] = tokens.map(() => true);
  const today = startOfDay(now);
  const listFor = (token: string) => lists.find((l) => norm(l.name) === norm(token.slice(1)));
  const priorityFor = (token: string) => (token.startsWith("!") ? PRIORITY_WORDS.get(token.slice(1).toLowerCase()) : undefined);

  // Tokens that are never part of a date phrase and that may follow one at the end.
  const meta = tokens.map((t, i) => {
    if (t.startsWith("#") && t.length > 1) return listFor(t) !== undefined;
    if (t.startsWith("!") && t.length > 1) return priorityFor(t) !== undefined;
    if (parseTime(t) !== null || lower[i] === "noon") return true;
    return lower[i] === "at" && i + 1 < tokens.length && (parseTime(tokens[i + 1]!) !== null || lower[i + 1] === "noon");
  });
  /** True when nothing but times, lists and priorities follow token `j`. */
  const endsAfter = (j: number) => meta.slice(j + 1).every(Boolean);
  const hinted = (i: number) => i > 0 && DATE_HINTS.has(lower[i - 1]!);
  /** Whether a date phrase of tokens `i` to `j` may be an ambiguous short form. */
  const plausible = (i: number, j: number) => hinted(i) || endsAfter(j);

  let day: Date | null = null;
  let time: { h: number; m: number } | null = null;
  let listId: string | null = null;
  let priority: Priority = "none";
  let priorityFound = false;
  let repeat: Repeat | null = null;
  /** Where "every fri" starts, unless the words name a date. */
  let firstWeekday: Date | null = null;

  const drop = (...indexes: number[]) => indexes.forEach((i) => (keep[i] = false));
  const dropHint = (i: number) => {
    if (i > 0 && keep[i - 1] && DROPPED_HINTS.has(lower[i - 1]!) && tokens.length > 2) keep[i - 1] = false;
  };
  const next = (i: number) => lower[i + 1] ?? "";

  for (let i = 0; i < tokens.length; i++) {
    if (!keep[i]) continue;
    const token = tokens[i]!;
    const word = lower[i]!;

    if (token.startsWith("#") && token.length > 1) {
      const match = listFor(token);
      if (match && listId === null) {
        listId = match.id;
        drop(i);
      }
      continue;
    }
    if (token.startsWith("!") && token.length > 1) {
      const p = priorityFor(token);
      if (p !== undefined && !priorityFound) {
        priority = p;
        priorityFound = true;
        drop(i);
      }
      continue;
    }

    if (word === "every" && repeat === null) {
      const found = parseEvery(lower, i);
      if (found) {
        repeat = found.repeat;
        for (let k = 0; k < found.used; k++) drop(i + k);
        if (found.weekday !== undefined) firstWeekday = addDays(today, ((found.weekday - today.getDay() + 6) % 7) + 1);
        continue;
      }
    }

    const t = parseTime(token);
    if (t && time === null) {
      time = t;
      drop(i);
      if (i > 0 && keep[i - 1] && lower[i - 1] === "at" && tokens.length > 2) drop(i - 1);
      continue;
    }
    if (word === "noon" && time === null) {
      time = { h: 12, m: 0 };
      drop(i);
      if (i > 0 && keep[i - 1] && lower[i - 1] === "at" && tokens.length > 2) drop(i - 1);
      continue;
    }

    if (day !== null) continue;

    if (word === "today") {
      day = today;
      drop(i);
    } else if (word === "tomorrow" || word === "tmrw") {
      day = addDays(today, 1);
      drop(i);
    } else if (word === "next" && next(i) === "week") {
      day = addDays(startOfWeek(today), 7);
      drop(i, i + 1);
    } else if (word === "next" && (FULL_WEEKDAYS.has(next(i)) || SHORT_WEEKDAYS.has(next(i)))) {
      const target = FULL_WEEKDAYS.get(next(i)) ?? SHORT_WEEKDAYS.get(next(i))!;
      day = addDays(startOfWeek(today), 7 + ((target + 6) % 7));
      drop(i, i + 1);
    } else if (FULL_WEEKDAYS.has(word) || (SHORT_WEEKDAYS.has(word) && !isAcronym(token) && plausible(i, i))) {
      const target = FULL_WEEKDAYS.get(word) ?? SHORT_WEEKDAYS.get(word)!;
      day = addDays(today, ((target - today.getDay() + 6) % 7) + 1);
      drop(i);
      dropHint(i);
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(token)) {
      const [y, m, d] = token.split("-").map(Number) as [number, number, number];
      const date = new Date(y, m - 1, d);
      if (date.getMonth() === m - 1 && date.getDate() === d) {
        day = date;
        drop(i);
        dropHint(i);
      }
    } else if (DAY_NUMBER.test(word) && MONTH_NAMES.has(next(i)) && !isAcronym(tokens[i + 1]!) && plausible(i, i + 1)) {
      const date = nextDate(parseInt(word, 10), MONTH_NAMES.get(next(i))!, now);
      if (date) {
        day = date;
        drop(i, i + 1);
        dropHint(i);
      }
    } else if (MONTH_NAMES.has(word) && !isAcronym(token) && DAY_NUMBER.test(next(i)) && plausible(i, i + 1)) {
      const date = nextDate(parseInt(next(i), 10), MONTH_NAMES.get(word)!, now);
      if (date) {
        day = date;
        drop(i, i + 1);
        dropHint(i);
      }
    }
  }

  const title = tokens.filter((_, i) => keep[i]).join(" ");
  if (title === "") {
    // Nothing left to call it: keep the words as the title and read nothing from them.
    return { title: raw, due: null, listId: null, priority: "none", repeat: null };
  }

  // A repeat starts on a date: the weekday it names, else today.
  if (repeat && day === null) day = firstWeekday ?? today;
  let due: string | null = null;
  if (day && time) {
    due = makeDue(new Date(day.getFullYear(), day.getMonth(), day.getDate(), time.h, time.m), true);
  } else if (day) {
    due = makeDue(day, false);
  } else if (time) {
    let at = new Date(today.getFullYear(), today.getMonth(), today.getDate(), time.h, time.m);
    if (at.getTime() < now.getTime()) at = addDays(at, 1);
    due = makeDue(at, true);
  }
  return { title, due, listId, priority, repeat };
}

/** "every Friday", "every weekday", "every 2 weeks". */
export function describeRepeat(r: Repeat): string {
  if (r.frequency === "weekly" && r.weekdays.length === WEEKDAY_SET.length && WEEKDAY_SET.every((d) => r.weekdays.includes(d))) return "every weekday";
  if (r.frequency === "weekly" && r.weekdays.length === 1 && r.interval === 1) {
    const name = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][DAYS.indexOf(r.weekdays[0]!)]!;
    return `every ${name}`;
  }
  const unit = { daily: "day", weekly: "week", monthly: "month", yearly: "year" }[r.frequency];
  return r.interval === 1 ? `every ${unit}` : `every ${r.interval} ${unit}s`;
}

/** The live preview: "Dentist · due Fri 13 Nov 15:00 · Errands · High". Empty when nothing was read from the words. */
export function describeParse(
  result: QuickAddResult,
  lists: readonly { id: string; name: string }[],
  now: Date,
): string {
  const bits = [
    result.due && `due ${formatDueLong(result.due, now)}`,
    result.repeat && describeRepeat(result.repeat),
    result.listId && lists.find((l) => l.id === result.listId)?.name,
    result.priority !== "none" && result.priority[0]!.toUpperCase() + result.priority.slice(1),
  ].filter(Boolean);
  return bits.length === 0 ? "" : [result.title, ...bits].join(" · ");
}
