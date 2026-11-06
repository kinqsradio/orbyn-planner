import { describe, expect, it } from "vitest";
import {
  MAX_OCCURRENCES,
  RepeatError,
  isOccurrence,
  newSeries,
  nextOnOrAfter,
  occurrences,
  occurrencesWith,
  repeatEvery,
  skip,
  splitAt,
  validate,
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
    expect(code(() => splitAt(first, date(2026, 11, 1)))).toBe("SplitAtFirst");
  });

  it("a_start_off_the_rule_is_not_an_occurrence_and_cannot_be_split_to_nothing", () => {
    // Saturday start, every Monday, five times.
    const s = series(date(2026, 11, 7), "weekly", (r) => {
      r.weekdays = ["mon"];
      r.end = { type: "count", value: 5 };
    });
    expect(isOccurrence(s, date(2026, 11, 7))).toBe(false);
    expect(occurrences(s, date(2026, 11, 1), date(2027, 1, 1))).toHaveLength(5);
    expect(code(() => splitAt(s, date(2026, 11, 9)))).toBe("SplitAtFirst");
    const [first, rest] = splitAt(s, date(2026, 11, 16));
    expect(first.repeat.end).toEqual({ type: "count", value: 1 });
    expect(rest.repeat.end).toEqual({ type: "count", value: 4 });
    expect(code(() => validate(first))).toBeNull();
    expect(code(() => validate(rest))).toBeNull();
  });

  it("weeks_start_on_monday", () => {
    // Sunday start, Monday and Sunday every 2 weeks.
    const s = series(date(2026, 11, 8), "weekly", (r) => {
      r.interval = 2;
      r.weekdays = ["mon", "sun"];
    });
    expect(occurrences(s, date(2026, 11, 1), date(2026, 11, 30))).toEqual([date(2026, 11, 8), date(2026, 11, 16), date(2026, 11, 22), date(2026, 11, 30)]);
  });

  it("skipping_twice_is_a_no_op", () => {
    let s = series(date(2026, 11, 7), "daily");
    s = skip(s, date(2026, 11, 8));
    s = skip(s, date(2026, 11, 8));
    expect(s.skipped).toHaveLength(1);
  });

  it("a_split_never_loses_or_doubles_an_occurrence", () => {
    const MASK = (1n << 64n) - 1n;
    let state = 7n;
    // SplitMix64, as in the Rust test, so both sides draw the same cases.
    const next = (): bigint => {
      state = (state + 0x9e3779b97f4a7c15n) & MASK;
      let z = state;
      z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK;
      z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK;
      return z ^ (z >> 31n);
    };
    const below = (n: number): number => Number(next() % BigInt(n));
    const plusDays = (d: string, n: number) => {
      const [y, m, dd] = d.split("-").map(Number) as [number, number, number];
      const t = new Date(Date.UTC(y, m - 1, dd + n));
      return date(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
    };
    const days: Day[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
    const frequencies: Frequency[] = ["daily", "weekly", "monthly", "yearly"];
    // Under two years, so a daily rule stays below MAX_OCCURRENCES.
    const [from, to] = [date(2026, 1, 1), date(2027, 11, 30)];
    let checked = 0;
    for (let i = 0; i < 3000; i++) {
      const start = plusDays(date(2026, 1, 1), below(400));
      const frequency = frequencies[below(4)]!;
      const repeat = repeatEvery(frequency);
      repeat.interval = 1 + below(3);
      if (frequency === "weekly" && below(2) === 0) {
        const count = 1 + below(3);
        repeat.weekdays = Array.from({ length: count }, () => days[below(7)]!);
      }
      const kind = below(3);
      repeat.end =
        kind === 0
          ? { type: "never" }
          : kind === 1
            ? { type: "count", value: 1 + below(20) }
            : { type: "until", value: plusDays(start, 30 + below(900)) };
      let original = newSeries(start, repeat);
      const all = occurrences(original, from, to);
      const picked = all.filter(() => below(5) === 0);
      for (const d of picked) original = skip(original, d);
      const kept = occurrences(original, from, to);
      if (kept.length < 2) continue;
      const at = kept[1 + below(kept.length - 1)]!;
      const [first, second] = splitAt(original, at);
      validate(first);
      validate(second);
      const joined = [...occurrences(first, from, to), ...occurrences(second, from, to)];
      expect(joined, `split of ${JSON.stringify(original)} at ${at}`).toEqual(kept);
      checked += 1;
    }
    expect(checked, `only ${checked} cases had a split point`).toBeGreaterThan(1000);
  }, 60_000);

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

describe("range checks and years before 100", () => {
  it("accepts only whole numbers in the engine's ranges", () => {
    const base = repeatEvery("daily");
    for (const interval of [1.5, 65536, -1, Number.NaN]) {
      expect(code(() => newSeries("2026-01-01", { ...base, interval }))).toMatch(/IntervalOutOfRange|ZeroInterval/);
    }
    expect(code(() => newSeries("2026-01-01", { ...base, interval: 65535 }))).toBeNull();
    for (const value of [0.5, 4294967296, -3]) {
      expect(code(() => newSeries("2026-01-01", { ...base, end: { type: "count", value } }))).toMatch(/CountOutOfRange|ZeroCount/);
    }
    expect(code(() => newSeries("2026-01-01", { ...base, end: { type: "count", value: 4294967295 } }))).toBeNull();
  });

  it("does not read years 0 to 99 as 1900 to 1999", () => {
    const s = newSeries("0050-02-27", repeatEvery("daily"));
    expect(occurrences(s, "0050-02-27", "0050-03-02")).toEqual(["0050-02-27", "0050-02-28", "0050-03-01", "0050-03-02"]);
    // Year 0 is a leap year in the proleptic calendar the engine uses.
    expect(occurrences(newSeries("0000-02-29", repeatEvery("yearly")), "0000-01-01", "0008-12-31")).toEqual(["0000-02-29", "0004-02-29", "0008-02-29"]);
  });
});

describe("jumping to the start of the range", () => {
  it("gives the same dates as walking from the start, for any rule", () => {
    let seed = 12345n;
    const MASK = (1n << 64n) - 1n;
    const next = (): bigint => {
      seed = (seed + 0x9e3779b97f4a7c15n) & MASK;
      let z = seed;
      z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK;
      z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK;
      return z ^ (z >> 31n);
    };
    const below = (n: number) => Number(next() % BigInt(n));
    const plus = (d: string, n: number) => {
      const t = new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10) + n));
      return date(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
    };
    const frequencies: Frequency[] = ["daily", "weekly", "monthly", "yearly"];
    const days: Day[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
    for (let i = 0; i < 400; i++) {
      const start = plus(date(2020, 1, 1), below(2000));
      const frequency = frequencies[below(4)]!;
      const repeat = repeatEvery(frequency);
      repeat.interval = 1 + below(frequency === "monthly" ? 20 : 4);
      if (frequency === "weekly" && below(2) === 0) repeat.weekdays = Array.from({ length: 1 + below(3) }, () => days[below(7)]!);
      const kind = below(3);
      repeat.end = kind === 0 ? { type: "never" } : kind === 1 ? { type: "count", value: 1 + below(400) } : { type: "until", value: plus(start, 30 + below(3000)) };
      const series = newSeries(start, repeat);
      const from = plus(start, below(2500) - 20);
      const to = plus(from, below(200));
      expect(occurrencesWith(series, from, to, true), JSON.stringify({ series, from, to })).toEqual(occurrencesWith(series, from, to, false));
      const probe = nextOnOrAfter(series, from);
      expect(probe).toBe(occurrencesWith(series, from, plus(from, 4000), false)[0] ?? null);
    }
  });

  it("a range far from the start is cheap: a daily series asked about 400 years on", () => {
    const s = newSeries("2026-01-01", repeatEvery("daily"));
    expect(occurrences(s, "2426-01-01", "2426-01-03")).toEqual(["2426-01-01", "2426-01-02", "2426-01-03"]);
  });

  it("still stops after 200,000 periods", () => {
    const s = newSeries("2026-01-01", repeatEvery("daily"));
    // Period 200,000 would be in year 2573; nothing falls after the last period the walk looks at.
    expect(occurrences(s, "2600-01-01", "2600-01-05")).toEqual([]);
  });
});
