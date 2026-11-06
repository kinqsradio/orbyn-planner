import { parseDue } from "../../lib/dates";
import type { QuietHours } from "../../app/prefs";
import type { Task } from "../../store/types";

/** A task with a date but no time reminds at this hour of its day. */
export const DATE_ONLY_HOUR = 9;
/** How far ahead timers are set; the schedule is rebuilt at least hourly, so a day is plenty. */
export const WINDOW_MS = 24 * 3_600_000;
/** A reminder that came due while the page was hidden is still shown if it is not older than this. */
export const GRACE_MS = 15 * 60_000;
const MAX_TIMER_MS = 2 ** 31 - 1;

/** When a task's reminder is due, or null: it needs a due date and a reminder, and not be done or deleted. */
export function reminderTime(task: Task): Date | null {
  if (task.reminder === null || task.reminder === undefined || task.due === null || task.done || task.deletedAt !== null) return null;
  const { date, hasTime } = parseDue(task.due);
  const base = hasTime ? date : new Date(date.getFullYear(), date.getMonth(), date.getDate(), DATE_ONLY_HOUR);
  // Whole days back are calendar days, so "1 day before" stays at the same hour across a clock change.
  if (task.reminder > 0 && task.reminder % 1440 === 0) {
    const at = new Date(base);
    at.setDate(at.getDate() - task.reminder / 1440);
    return at;
  }
  return new Date(base.getTime() - task.reminder * 60_000);
}

const minutes = (hhmm: string) => {
  const [h = 0, m = 0] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

/** Whether a moment falls in quiet hours. The start is inside, the end is not; a window may cross midnight. */
export function inQuietHours(at: Date, quiet: QuietHours): boolean {
  if (!quiet.enabled) return false;
  const now = at.getHours() * 60 + at.getMinutes();
  const from = minutes(quiet.from);
  const to = minutes(quiet.to);
  if (from === to) return false;
  return from < to ? now >= from && now < to : now >= from || now < to;
}

export interface Reminder {
  /** Stable for one task and one reminder moment, so a reminder is shown once. */
  key: string;
  task: Task;
  at: Date;
}

export function remindersFor(tasks: readonly Task[]): Reminder[] {
  const out: Reminder[] = [];
  for (const task of tasks) {
    const at = reminderTime(task);
    if (at) out.push({ key: `${task.id}|${at.getTime()}`, task, at });
  }
  return out.sort((a, b) => a.at.getTime() - b.at.getTime());
}

export interface SchedulerOptions {
  now: () => Date;
  quiet: () => QuietHours;
  /** Show one reminder. */
  notify: (reminder: Reminder) => void;
}

/**
 * Keeps one timer per upcoming reminder (within a day) and shows each once, unless it falls in
 * quiet hours. Timers are not reliable in a hidden tab, so `check` also shows any reminder that
 * came due a moment ago; call it when the page becomes visible. Only works while the app is open.
 */
export class ReminderScheduler {
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private shown = new Set<string>();
  private tasks: readonly Task[] = [];

  constructor(private readonly options: SchedulerOptions) {}

  /** Rebuilds the timers for a new set of tasks. A moved or removed reminder loses its timer. */
  update(tasks: readonly Task[]): void {
    this.tasks = tasks;
    this.clear();
    const now = this.options.now().getTime();
    for (const r of remindersFor(tasks)) {
      const wait = r.at.getTime() - now;
      if (this.shown.has(r.key) || wait <= 0 || wait > WINDOW_MS) continue;
      this.timers.set(
        r.key,
        setTimeout(() => {
          this.timers.delete(r.key);
          this.show(r);
        }, Math.min(wait, MAX_TIMER_MS)),
      );
    }
    this.check();
  }

  /** Shows reminders that are due now or came due within the grace period and were not shown. */
  check(): void {
    const now = this.options.now().getTime();
    for (const r of remindersFor(this.tasks)) {
      const age = now - r.at.getTime();
      if (age >= 0 && age <= GRACE_MS) this.show(r);
    }
  }

  private show(r: Reminder): void {
    if (this.shown.has(r.key)) return;
    this.shown.add(r.key);
    if (inQuietHours(this.options.now(), this.options.quiet())) return;
    this.options.notify(r);
  }

  private clear(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }

  stop(): void {
    this.clear();
  }
}
