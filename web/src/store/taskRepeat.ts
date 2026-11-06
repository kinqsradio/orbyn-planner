import { addDays, dateOf, makeDue } from "../lib/dates";
import type { Scope } from "./eventScope";
import { breaksCycle, CannotMoveSeries, shiftWeekdays } from "./eventScope";
import { countBefore, nextOnOrAfter, newSeries, skip, type Repeat, type Series } from "./repeat";
import type { PlannerStore, Task } from "./types";

const dateKeyOf = (due: string) => due.slice(0, 10);
const timeOf = (due: string | null) => (due && due.length > 10 ? due.slice(10) : "");
const dayAfter = (day: string) => makeDue(addDays(dateOf(day), 1), false);

/** Keeps the most recent completions; "Done this week" never needs more. */
const MAX_COMPLETIONS = 200;

/**
 * What completing a repeating task changes: the due moves to the next occurrence at the same time
 * of day, and the completion is recorded. When the series has no more occurrences (a count end
 * reached, or an until date passed) the task is finished instead.
 */
export function completeRepeating(task: Task, nowIso: string): Record<string, unknown> {
  const series = task.repeat!;
  const completions = [...(task.completions ?? []), nowIso].slice(-MAX_COMPLETIONS);
  const current = dateKeyOf(task.due ?? series.start);
  // Steps start unticked for the next time round.
  const checklist = task.checklist.some((c) => c.done) ? task.checklist.map((c) => ({ ...c, done: false })) : task.checklist;
  const next = nextOnOrAfter(series, dayAfter(current));
  if (next === null) return { done: true, completedAt: nowIso, completions };
  return { due: next + timeOf(task.due), done: false, completedAt: null, completions, checklist };
}

/** The first occurrence on or after `today`, for "Skip to next upcoming" on an overdue repeating task. */
export function nextUpcoming(task: Task, today: string): string | null {
  const series = task.repeat;
  if (!series) return null;
  const next = nextOnOrAfter(series, today);
  return next === null ? null : next + timeOf(task.due);
}

/** What a person changed on a repeating task's due or repeat. `repeat` undefined means not touched. */
export interface RepeatEdit {
  due?: string | null;
  repeat?: Repeat | null;
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
const shiftDay = (day: string, by: number) => makeDue(addDays(dateOf(day), by), false);

/** Which scopes make sense for an edit: a changed rule can't apply to just one date. */
export function allowedScopes(edit: RepeatEdit): readonly Scope[] {
  return edit.repeat ? ["following", "all"] : ["this", "following", "all"];
}

/**
 * Applies an edit to a task's due or repeat. For a repeating task the scope decides how far it
 * reaches. "This task" skips this date in the series and makes a one-off copy on the new date,
 * linked back to the date it replaces. "This and following" starts the rule afresh from the new
 * date with the rest of its count. "All" moves the whole series, so its count stays whole.
 * Moving a series moves its weekdays too; where that cannot be said as one rule it throws
 * CannotMoveSeries. A repeat needs a due date, so clearing the due ends the repeat.
 */
export function editTaskRepeat(store: PlannerStore, task: Task, edit: RepeatEdit, scope: Scope, today: string): void {
  const due = edit.due === undefined ? task.due : edit.due;
  const series = task.repeat;

  if (edit.due === null) {
    store.updateTask(task.id, { due: null, repeat: null });
    return;
  }
  if (edit.repeat === null) {
    store.updateTask(task.id, { repeat: null, ...(edit.due !== undefined ? { due } : {}) });
    return;
  }
  const day = due ? dateKeyOf(due) : today;

  if (!series) {
    if (edit.repeat) store.updateTask(task.id, { due: due ?? day, repeat: newSeries(day, edit.repeat) });
    else if (edit.due !== undefined) store.updateTask(task.id, { due });
    return;
  }

  const currentDue = dateKeyOf(task.due ?? series.start);
  const by = daysBetween(currentDue, day);

  if (scope === "this") {
    if (edit.repeat) return; // a changed rule never applies to one date
    if (edit.due === undefined || due === task.due) return;
    const skipped = skip(series, currentDue);
    const upcoming = nextOnOrAfter(skipped, currentDue);
    // With no date left in the series, replacing this one finishes it.
    store.updateTask(task.id, upcoming !== null ? { repeat: skipped, due: upcoming + timeOf(task.due) } : { repeat: skipped, done: true, completedAt: store.nowIso() });
    store.addTask({
      title: task.title,
      notes: task.notes,
      listId: task.listId,
      priority: task.priority,
      projectId: task.projectId,
      sectionId: task.sectionId,
      reminder: task.reminder,
      checklist: task.checklist.map((c) => ({ ...c, id: crypto.randomUUID() })),
      due,
      overrideOf: { id: task.id, date: currentDue },
    });
    return;
  }

  let next: Series;
  if (scope === "following") {
    const later = series.skipped.filter((d) => d >= currentDue).map((d) => shiftDay(d, by));
    if (edit.repeat) next = { ...newSeries(day, edit.repeat), skipped: later };
    else {
      if (breaksCycle(series, by)) throw new CannotMoveSeries();
      next = { ...remaining(series, currentDue, day), repeat: { ...remaining(series, currentDue, day).repeat, weekdays: shiftWeekdays(series.repeat.weekdays, by) }, skipped: later };
    }
  } else {
    const start = shiftDay(series.start, by);
    const skipped = series.skipped.map((d) => shiftDay(d, by));
    if (edit.repeat) next = { ...newSeries(start, edit.repeat), skipped };
    else {
      if (breaksCycle(series, by)) throw new CannotMoveSeries();
      next = { start, repeat: { ...series.repeat, weekdays: shiftWeekdays(series.repeat.weekdays, by) }, skipped };
    }
  }
  store.updateTask(task.id, { ...(edit.due !== undefined ? { due } : {}), repeat: next });
  // One-off copies of single dates travel with the series by the same number of days.
  if (scope === "all" && by !== 0) {
    for (const copy of store.getState().tasks) {
      if (copy.overrideOf?.id !== task.id || copy.deletedAt !== null) continue;
      store.updateTask(copy.id, { due: copy.due ? shiftDay(copy.due.slice(0, 10), by) + timeOf(copy.due) : copy.due, overrideOf: { id: task.id, date: shiftDay(copy.overrideOf.date, by) } });
    }
  }
}

/** The series for "this and following": from the new date, with a count shortened by what has been used. */
function remaining(series: Series, currentDue: string, start: string): Series {
  const end = series.repeat.end;
  if (end.type !== "count") return { start, repeat: { ...series.repeat }, skipped: [] };
  const used = countBefore(series, currentDue);
  return { start, repeat: { ...series.repeat, end: { type: "count", value: Math.max(end.value - used, 1) } }, skipped: [] };
}

/** The fields an undo puts back on a task. */
const TASK_FIELDS = ["title", "notes", "listId", "due", "priority", "checklist", "projectId", "sectionId", "repeat", "reminder", "completions", "done", "completedAt", "overrideOf"] as const;

/**
 * Runs a change to tasks and returns how to undo it: tasks it changed go back to what they were
 * (the due, the repeat and its skipped dates, whether it was done), and tasks it made are deleted.
 */
export function undoableTasks<T>(store: PlannerStore, run: () => T): { result: T; undo: () => void } {
  const before = new Map(store.getState().tasks.map((t) => [t.id, t]));
  const result = run();
  const changed = store.getState().tasks.filter((t) => before.has(t.id) && JSON.stringify(before.get(t.id)) !== JSON.stringify(t));
  const made = store.getState().tasks.filter((t) => !before.has(t.id));
  return {
    result,
    undo: () => {
      for (const t of made) store.deleteTask(t.id);
      for (const t of changed) {
        const was = before.get(t.id)!;
        store.updateTask(t.id, Object.fromEntries(TASK_FIELDS.map((f) => [f, was[f]])));
      }
    },
  };
}
