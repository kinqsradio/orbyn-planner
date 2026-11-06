import { addDays, dateOf, makeDue } from "../lib/dates";
import type { Scope } from "./eventScope";
import { countBefore, nextOnOrAfter, newSeries, type Repeat, type Series } from "./repeat";
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
  const next = nextOnOrAfter(series, dayAfter(current));
  if (next === null) return { done: true, completedAt: nowIso, completions };
  return { due: next + timeOf(task.due), done: false, completedAt: null, completions };
}

/** What a person changed on a repeating task's due or repeat. `repeat` undefined means not touched. */
export interface RepeatEdit {
  due?: string | null;
  repeat?: Repeat | null;
}

/** The series for "this and following": from the new date, with a count shortened by what has been used. */
function remaining(series: Series, currentDue: string, start: string): Series {
  const end = series.repeat.end;
  if (end.type !== "count") return { start, repeat: { ...series.repeat }, skipped: [] };
  const used = countBefore(series, currentDue);
  return { start, repeat: { ...series.repeat, end: { type: "count", value: Math.max(end.value - used, 1) } }, skipped: [] };
}

/**
 * Applies an edit to a task's due or repeat. For a repeating task the scope decides how far it
 * reaches: "This task" changes only this occurrence's due, "This and following" starts the rule
 * afresh from the new date with the rest of its count, and "All" restarts the whole series there.
 * A repeat needs a due date, so clearing the due ends the repeat.
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

  if (scope === "this") {
    if (edit.due !== undefined) store.updateTask(task.id, { due });
    return;
  }
  const currentDue = dateKeyOf(task.due ?? series.start);
  let next: Series;
  if (edit.repeat) next = newSeries(day, edit.repeat);
  else if (scope === "following") next = remaining(series, currentDue, day);
  else next = { ...series, start: day, skipped: [] };
  store.updateTask(task.id, { ...(edit.due !== undefined ? { due } : {}), repeat: next });
}
