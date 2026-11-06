import { useState } from "react";
import { dayOf, DAYS, newSeries, repeatEvery, RepeatError, type Day, type Frequency, type Repeat } from "../../store/repeat";

export type RepeatKind = "never" | "daily" | "weekdays" | "weekly-on" | "monthly" | "yearly" | "custom";

export const REPEAT_KINDS: readonly { value: RepeatKind; label: string }[] = [
  { value: "never", label: "Never" },
  { value: "daily", label: "Daily" },
  { value: "weekdays", label: "Weekdays" },
  { value: "weekly-on", label: "Weekly on…" },
  { value: "monthly", label: "Monthly" },
  { value: "yearly", label: "Yearly" },
  { value: "custom", label: "Custom…" },
];

const WEEKDAYS: Day[] = ["mon", "tue", "wed", "thu", "fri"];
const DAY_LABELS: Record<Day, string> = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };
const UNITS: readonly { value: Frequency; one: string; many: string }[] = [
  { value: "daily", one: "day", many: "days" },
  { value: "weekly", one: "week", many: "weeks" },
  { value: "monthly", one: "month", many: "months" },
  { value: "yearly", one: "year", many: "years" },
];

const sameDays = (a: Day[], b: Day[]) => a.length === b.length && a.every((d) => b.includes(d));

/** Which menu entry describes a rule. Anything the simple entries cannot say is Custom. */
export function kindOf(repeat: Repeat | null): RepeatKind {
  if (!repeat) return "never";
  const plain = repeat.interval === 1 && repeat.end.type === "never";
  if (plain && repeat.frequency === "daily") return "daily";
  if (plain && repeat.frequency === "weekly") return sameDays(repeat.weekdays, WEEKDAYS) ? "weekdays" : "weekly-on";
  if (plain && repeat.frequency === "monthly") return "monthly";
  if (plain && repeat.frequency === "yearly") return "yearly";
  return "custom";
}

/** The rule a menu entry stands for. Weekly-on starts with the start date's weekday; Custom keeps the current rule. */
export function ruleFor(kind: RepeatKind, start: string, current: Repeat | null): Repeat | null {
  switch (kind) {
    case "never":
      return null;
    case "daily":
    case "monthly":
    case "yearly":
      return repeatEvery(kind);
    case "weekdays":
      return { ...repeatEvery("weekly"), weekdays: [...WEEKDAYS] };
    case "weekly-on":
      return { ...repeatEvery("weekly"), weekdays: [dayOf(start)] };
    case "custom":
      return current ?? { ...repeatEvery("daily"), interval: 2 };
  }
}

/** A rule the engine accepts, or the reason it does not. */
function problem(rule: Repeat, start: string): string | null {
  try {
    newSeries(start, rule);
    return null;
  } catch (e) {
    return e instanceof RepeatError ? e.message : "That repeat doesn’t work.";
  }
}

function Weekdays({ value, onChange }: { value: Day[]; onChange: (days: Day[]) => void }) {
  return (
    <div className="pills" role="group" aria-label="On these days">
      {DAYS.map((d) => (
        <button
          key={d}
          type="button"
          className="pill"
          aria-pressed={value.includes(d)}
          onClick={() => {
            const next = value.includes(d) ? value.filter((x) => x !== d) : [...value, d];
            if (next.length > 0) onChange(next);
          }}
        >
          {DAY_LABELS[d]}
        </button>
      ))}
    </div>
  );
}

/**
 * Never, Daily, Weekdays, Weekly on…, Monthly, Yearly or Custom (every N days, weeks, months or
 * years, on chosen weekdays, ending never, on a date or after some times). It only reports rules
 * the engine's validation accepts. `start` is the date of the first due, `YYYY-MM-DD`.
 */
export function RepeatPicker({ value, start, onChange }: { value: Repeat | null; start: string; onChange: (rule: Repeat | null) => void }) {
  const [kind, setKind] = useState<RepeatKind>(() => kindOf(value));
  const [draft, setDraft] = useState<Repeat | null>(value);
  const [error, setError] = useState<string | null>(null);
  // What is typed in the number fields, so a field can be emptied on the way to a new number.
  const [everyText, setEveryText] = useState(String(value?.interval ?? 2));
  const [timesText, setTimesText] = useState(String(value?.end.type === "count" ? value.end.value : 10));

  const change = (rule: Repeat | null) => {
    setDraft(rule);
    const bad = rule ? problem(rule, start) : null;
    setError(bad);
    if (!bad) onChange(rule);
  };

  return (
    <div className="repeat-picker">
      <select
        className="inp"
        aria-label="Repeat"
        value={kind}
        onChange={(e) => {
          const next = e.target.value as RepeatKind;
          setKind(next);
          change(ruleFor(next, start, draft));
        }}
      >
        {REPEAT_KINDS.map((k) => (
          <option key={k.value} value={k.value}>{k.label}</option>
        ))}
      </select>

      {kind === "weekly-on" && draft && <Weekdays value={draft.weekdays} onChange={(weekdays) => change({ ...draft, weekdays })} />}

      {kind === "custom" && draft && (
        <div className="repeat-custom">
          <div className="ctl">
            <span>Every</span>
            <input
              className="inp narrow"
              type="number"
              min={1}
              aria-label="Every"
              value={everyText}
              onChange={(e) => {
                setEveryText(e.target.value);
                const n = Math.floor(Number(e.target.value));
                if (n >= 1) change({ ...draft, interval: n });
              }}
            />
            <select
              className="inp"
              aria-label="Unit"
              value={draft.frequency}
              onChange={(e) => {
                const frequency = e.target.value as Frequency;
                change({ ...draft, frequency, weekdays: frequency === "weekly" ? draft.weekdays : [] });
              }}
            >
              {UNITS.map((u) => (
                <option key={u.value} value={u.value}>{draft.interval === 1 ? u.one : u.many}</option>
              ))}
            </select>
          </div>
          {draft.frequency === "weekly" && (
            <Weekdays value={draft.weekdays.length ? draft.weekdays : [dayOf(start)]} onChange={(weekdays) => change({ ...draft, weekdays })} />
          )}
          <div className="ctl">
            <span>Ends</span>
            <select
              className="inp"
              aria-label="Ends"
              value={draft.end.type}
              onChange={(e) => {
                const type = e.target.value;
                change({ ...draft, end: type === "until" ? { type: "until", value: start } : type === "count" ? { type: "count", value: 10 } : { type: "never" } });
              }}
            >
              <option value="never">Never</option>
              <option value="until">On a date</option>
              <option value="count">After a number of times</option>
            </select>
            {draft.end.type === "until" && (
              <input className="inp" type="date" aria-label="Ends on" value={draft.end.value} onChange={(e) => change({ ...draft, end: { type: "until", value: e.target.value } })} />
            )}
            {draft.end.type === "count" && (
              <input
                className="inp narrow"
                type="number"
                min={1}
                aria-label="Times"
                value={timesText}
                onChange={(e) => {
                  setTimesText(e.target.value);
                  const n = Math.floor(Number(e.target.value));
                  if (n >= 1) change({ ...draft, end: { type: "count", value: n } });
                }}
              />
            )}
          </div>
        </div>
      )}
      {error && <p className="err">{error}</p>}
    </div>
  );
}
