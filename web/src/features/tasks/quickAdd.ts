import { MONTHS, addDays, makeDue, startOfDay, startOfWeek } from "../../lib/dates";
import type { Priority } from "../../store/types";

export interface QuickAddResult {
  title: string;
  /** `YYYY-MM-DD` or `YYYY-MM-DDTHH:mm`, or null when no date or time was written. */
  due: string | null;
  /** The matched list, or null to leave the task in the Inbox. */
  listId: string | null;
  priority: Priority;
}

const PRIORITY_WORDS: Record<string, Priority> = {
  high: "high", h: "high", "3": "high",
  medium: "medium", med: "medium", m: "medium", "2": "medium",
  low: "low", l: "low", "1": "low",
  none: "none",
};

const WEEKDAY_ALIASES: Record<string, number> = {
  sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6,
};

const MONTH_ALIASES: Record<string, number> = {};
MONTHS.forEach((name, i) => {
  MONTH_ALIASES[name.toLowerCase()] = i;
  MONTH_ALIASES[name.slice(0, 3).toLowerCase()] = i;
});
MONTH_ALIASES["sept"] = 8;

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "");

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

/** Next date for a day-of-month and month, this year or the next if it has passed. */
function nextDate(day: number, month: number, now: Date): Date | null {
  const make = (year: number) => {
    const d = new Date(year, month, day);
    return d.getMonth() === month && d.getDate() === day ? d : null;
  };
  const thisYear = make(now.getFullYear());
  if (thisYear && thisYear.getTime() >= startOfDay(now).getTime()) return thisYear;
  return make(now.getFullYear() + 1);
}

/**
 * Reads plain words from a quick-add line: a day (today, tomorrow, a weekday, "next week",
 * "14 nov", 2026-11-14), a time (3pm, 15:00), `#list` and `!priority`. Everything else is the
 * title. A weekday means its next occurrence after today; "next friday" is that day in the
 * following Monday to Sunday week. A time with no day means today, or tomorrow once it has passed.
 */
export function parseQuickAdd(
  text: string,
  now: Date,
  lists: readonly { id: string; name: string }[],
): QuickAddResult {
  const raw = text.trim().replace(/\s+/g, " ");
  const tokens = raw === "" ? [] : raw.split(" ");
  const keep: boolean[] = tokens.map(() => true);
  let day: Date | null = null;
  let time: { h: number; m: number } | null = null;
  let listId: string | null = null;
  let priority: Priority = "none";
  let priorityFound = false;
  const today = startOfDay(now);

  const next = (i: number) => tokens[i + 1]?.toLowerCase() ?? "";
  const drop = (...indexes: number[]) => indexes.forEach((i) => (keep[i] = false));
  /** Also drops a directly preceding filler word ("at 3pm", "on friday"). */
  const dropWithFiller = (i: number, filler: string) => {
    drop(i);
    if (i > 0 && keep[i - 1] && tokens[i - 1]!.toLowerCase() === filler && tokens.length > 2) drop(i - 1);
  };

  for (let i = 0; i < tokens.length; i++) {
    if (!keep[i]) continue;
    const token = tokens[i]!;
    const lower = token.toLowerCase();

    if (token.startsWith("#") && token.length > 1) {
      const match = lists.find((l) => norm(l.name) === norm(token.slice(1)));
      if (match && listId === null) {
        listId = match.id;
        drop(i);
      }
      continue;
    }
    if (token.startsWith("!") && token.length > 1) {
      const p = PRIORITY_WORDS[lower.slice(1)];
      if (p && !priorityFound) {
        priority = p;
        priorityFound = true;
        drop(i);
      }
      continue;
    }

    const t = parseTime(token);
    if (t && time === null) {
      time = t;
      dropWithFiller(i, "at");
      continue;
    }
    if (lower === "noon" && time === null) {
      time = { h: 12, m: 0 };
      dropWithFiller(i, "at");
      continue;
    }

    if (day !== null) continue;

    if (lower === "today") {
      day = today;
      drop(i);
    } else if (lower === "tomorrow" || lower === "tmrw") {
      day = addDays(today, 1);
      drop(i);
    } else if (lower === "next" && next(i) === "week") {
      day = addDays(startOfWeek(today), 7);
      drop(i, i + 1);
    } else if (lower === "next" && next(i) in WEEKDAY_ALIASES) {
      const target = WEEKDAY_ALIASES[next(i)]!;
      day = addDays(startOfWeek(today), 7 + ((target + 6) % 7));
      drop(i, i + 1);
    } else if (lower in WEEKDAY_ALIASES) {
      const ahead = ((WEEKDAY_ALIASES[lower]! - today.getDay() + 6) % 7) + 1;
      day = addDays(today, ahead);
      dropWithFiller(i, "on");
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(token)) {
      const [y, m, d] = token.split("-").map(Number) as [number, number, number];
      const date = new Date(y, m - 1, d);
      if (date.getMonth() === m - 1 && date.getDate() === d) {
        day = date;
        dropWithFiller(i, "on");
      }
    } else if (/^\d{1,2}(st|nd|rd|th)?$/.test(lower) && next(i) in MONTH_ALIASES) {
      const date = nextDate(parseInt(lower, 10), MONTH_ALIASES[next(i)]!, now);
      if (date) {
        day = date;
        drop(i, i + 1);
        if (i > 0 && keep[i - 1] && tokens[i - 1]!.toLowerCase() === "on" && tokens.length > 3) drop(i - 1);
      }
    } else if (lower in MONTH_ALIASES && /^\d{1,2}(st|nd|rd|th)?$/.test(next(i))) {
      const date = nextDate(parseInt(tokens[i + 1]!, 10), MONTH_ALIASES[lower]!, now);
      if (date) {
        day = date;
        drop(i, i + 1);
        if (i > 0 && keep[i - 1] && tokens[i - 1]!.toLowerCase() === "on" && tokens.length > 3) drop(i - 1);
      }
    }
  }

  const title = tokens.filter((_, i) => keep[i]).join(" ");
  if (title === "") {
    // Nothing left to call it: keep the words as the title and read nothing from them.
    return { title: raw, due: null, listId: null, priority: "none" };
  }

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
  return { title, due, listId, priority };
}

