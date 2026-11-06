import { describe, expect, it } from "vitest";
import {
  MAX_OCCURRENCES,
  RepeatError,
  isOccurrence,
  newSeries,
  nextOnOrAfter,
  occurrences,
  repeatEvery,
  skip,
  splitAt,
  type Day,
  type End,
  type Frequency,
  type Repeat,
  type Series,
} from "./repeat";

/** `date(2026, 11, 7)` as the engine's tests write it. */
const date = (y: number, m: number, d: number) => `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

function series(start: string, frequency: Frequency, f: (r: Repeat) => void = () => undefined): Series {
  const repeat = repeatEvery(frequency);
  f(repeat);
  return newSeries(start, repeat);
}

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof RepeatError ? e.code : "other";
  }
  return null;
};

describe("repeat rules (ported from orbyn-planner repeat.rs)", () => {
  it("daily_every_two_days", () => {
    const s = series(date(2026, 11, 7), "daily", (r) => (r.interval = 2));
    expect(occurrences(s, date(2026, 11, 1), date(2026, 11, 13))).toEqual([
      date(2026, 11, 7), date(2026, 11, 9), date(2026, 11, 11), date(2026, 11, 13),
    ]);
  });

  it("weekly_on_chosen_weekdays_starts_on_or_after_the_start", () => {
    // Saturday 7 November 2026.
    const s = series(date(2026, 11, 7), "weekly", (r) => (r.weekdays = ["mon", "sat"] as Day[]));
    expect(occurrences(s, date(2026, 11, 1), date(2026, 11, 17))).toEqual([
      date(2026, 11, 7), date(2026, 11, 9), date(2026, 11, 14), date(2026, 11, 16),
    ]);
  });

  it("every_other_week_on_the_start_weekday", () => {
    const s = series(date(2026, 11, 7), "weekly", (r) => (r.interval = 2));
    expect(occurrences(s, date(2026, 11, 7), date(2026, 12, 5))).toEqual([date(2026, 11, 7), date(2026, 11, 21), date(2026, 12, 5)]);
  });

  it("monthly_on_the_31st_skips_short_months", () => {
    const s = series(date(2026, 1, 31), "monthly");
    expect(occurrences(s, date(2026, 1, 1), date(2026, 6, 30))).toEqual([date(2026, 1, 31), date(2026, 3, 31), date(2026, 5, 31)]);
  });

  it("yearly_on_29_february_only_in_leap_years", () => {
    const s = series(date(2028, 2, 29), "yearly");
    expect(occurrences(s, date(2028, 1, 1), date(2036, 12, 31))).toEqual([date(2028, 2, 29), date(2032, 2, 29), date(2036, 2, 29)]);
  });

  it("count_and_until_end_the_series", () => {
    let s = series(date(2026, 11, 7), "daily", (r) => (r.end = { type: "count", value: 3 }));
    expect(occurrences(s, date(2026, 1, 1), date(2027, 1, 1))).toHaveLength(3);
    s = series(date(2026, 11, 7), "daily", (r) => (r.end = { type: "until", value: date(2026, 11, 9) }));
    expect(occurrences(s, date(2026, 1, 1), date(2027, 1, 1)).at(-1)).toBe(date(2026, 11, 9));
  });

  it("invalid_rules_are_refused", () => {
    let r = repeatEvery("daily");
    r.interval = 0;
    expect(code(() => newSeries(date(2026, 1, 1), r))).toBe("ZeroInterval");
    r = repeatEvery("daily");
    r.end = { type: "count", value: 0 };
    expect(code(() => newSeries(date(2026, 1, 1), r))).toBe("ZeroCount");
    r = repeatEvery("daily");
    r.end = { type: "until", value: date(2025, 1, 1) };
    expect(code(() => newSeries(date(2026, 1, 1), r))).toBe("EndsBeforeStart");
    r = repeatEvery("monthly");
    r.weekdays = ["mon"];
    expect(code(() => newSeries(date(2026, 1, 1), r))).toBe("WeekdaysNotWeekly");
  });

  it("this_one_only_skips_a_date", () => {
    let s = series(date(2026, 11, 7), "daily");
    s = skip(s, date(2026, 11, 8));
    expect(occurrences(s, date(2026, 11, 7), date(2026, 11, 9))).toEqual([date(2026, 11, 7), date(2026, 11, 9)]);
    expect(code(() => skip(s, date(2026, 11, 6)))).toBe("NotAnOccurrence");
  });

  it("this_and_following_splits_without_losing_or_doubling_dates", () => {
    const original = series(date(2026, 11, 2), "weekly");
    const [first, second] = splitAt(original, date(2026, 11, 16));
    const range: [string, string] = [date(2026, 11, 1), date(2026, 12, 31)];
    const together = [...occurrences(first, ...range), ...occurrences(second, ...range)];
    expect(together).toEqual(occurrences(original, ...range));
    expect(first.repeat.end).toEqual({ type: "until", value: date(2026, 11, 15) } satisfies End);
  });

  it("splitting_a_counted_series_shares_the_count", () => {
    const first = series(date(2026, 11, 1), "daily", (r) => (r.end = { type: "count", value: 10 }));
    const [a, b] = splitAt(first, date(2026, 11, 4));
    expect(a.repeat.end).toEqual({ type: "count", value: 3 });
    expect(b.repeat.end).toEqual({ type: "count", value: 7 });
    expect(code(() => splitAt(first, date(2026, 11, 1)))).toBe("NotAnOccurrence");
  });

  it("a_huge_range_stops_at_the_limit", () => {
    const s = series(date(2026, 1, 1), "daily");
    expect(occurrences(s, date(2026, 1, 1), date(9999, 12, 31))).toHaveLength(MAX_OCCURRENCES);
  });

  it("rules_round_trip_through_json", () => {
    const s = series(date(2026, 11, 7), "weekly", (r) => {
      r.weekdays = ["mon"];
      r.end = { type: "count", value: 4 };
    });
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
    expect(JSON.parse(JSON.stringify(s)).repeat.end).toEqual({ type: "count", value: 4 });
  });
});

describe("repeat helpers", () => {
  it("nextOnOrAfter and isOccurrence", () => {
    const s = series(date(2026, 11, 7), "weekly");
    expect(nextOnOrAfter(s, date(2026, 11, 8))).toBe(date(2026, 11, 14));
    expect(isOccurrence(s, date(2026, 11, 14))).toBe(true);
    expect(isOccurrence(s, date(2026, 11, 15))).toBe(false);
  });

  it("a split keeps skipped dates with the half they belong to and makes weekdays explicit", () => {
    let s = series(date(2026, 11, 2), "weekly");
    s = skip(s, date(2026, 11, 9));
    s = skip(s, date(2026, 11, 23));
    const [first, following] = splitAt(s, date(2026, 11, 16));
    expect(first.skipped).toEqual([date(2026, 11, 9)]);
    expect(following.skipped).toEqual([date(2026, 11, 23)]);
    expect(following.repeat.weekdays).toEqual(["mon"]);
  });
});
