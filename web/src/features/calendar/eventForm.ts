import { repeatEvery, type Frequency, type Repeat, type Series } from "../../store/repeat";
import type { Person, Response } from "../../store/types";

export const REMINDERS: readonly { value: number | null; label: string }[] = [
  { value: null, label: "None" },
  { value: 0, label: "At the start" },
  { value: 5, label: "5 minutes before" },
  { value: 10, label: "10 minutes before" },
  { value: 15, label: "15 minutes before" },
  { value: 30, label: "30 minutes before" },
  { value: 60, label: "1 hour before" },
  { value: 1440, label: "1 day before" },
];

export type RepeatChoice = "never" | Frequency | "keep";

export const REPEAT_CHOICES: readonly { value: Exclude<RepeatChoice, "keep">; label: string }[] = [
  { value: "never", label: "Never" },
  { value: "daily", label: "Every day" },
  { value: "weekly", label: "Every week" },
  { value: "monthly", label: "Every month" },
  { value: "yearly", label: "Every year" },
];

/** The choice that describes a series, or "keep" for a rule the menu cannot express (every 2 weeks, on chosen days, ending). */
export function choiceOf(series: Series | null): RepeatChoice {
  if (!series) return "never";
  const r = series.repeat;
  return r.interval === 1 && r.weekdays.length === 0 && r.end.type === "never" ? r.frequency : "keep";
}

/** The rule to save for a choice: undefined leaves the rule as it was. */
export function ruleOf(choice: RepeatChoice): Repeat | null | undefined {
  if (choice === "keep") return undefined;
  return choice === "never" ? null : repeatEvery(choice);
}

export const RESPONSE_LABELS: Record<Response, string> = { accepted: "Going", declined: "Not going", tentative: "Maybe", none: "No reply" };

/** People from comma, semicolon or space separated emails. Keeps the ones that look like addresses. */
export function parsePeople(text: string, existing: readonly Person[] = []): Person[] {
  const seen = new Set(existing.map((p) => p.email.toLowerCase()));
  const out = [...existing];
  for (const raw of text.split(/[\s,;]+/)) {
    const email = raw.trim();
    if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) && !seen.has(email.toLowerCase())) {
      seen.add(email.toLowerCase());
      out.push({ email, response: "none" });
    }
  }
  return out;
}

export function reminderLabel(minutes: number | null): string {
  return REMINDERS.find((r) => r.value === minutes)?.label ?? `${minutes} minutes before`;
}
