import { addDays, compareDue, dateKey, dueDayKey, isDueToday, isOverdue, startOfDay, startOfWeek } from "../../lib/dates";
import type { Task } from "../../store/types";

export type DueFilter = "any" | "today" | "week" | "overdue";

export const DUE_FILTERS: readonly { id: DueFilter; label: string }[] = [
  { id: "any", label: "Any due date" },
  { id: "today", label: "Today" },
  { id: "week", label: "This week" },
  { id: "overdue", label: "Overdue" },
];

export const isLive = (t: Task) => t.deletedAt === null;
export const isOpen = (t: Task) => t.deletedAt === null && !t.done;

/** Open tasks, plus tasks finished today so a completed task stays where it was until tomorrow. */
export function activeTasks(tasks: readonly Task[], now: Date): Task[] {
  const dayStart = startOfDay(now).getTime();
  return tasks.filter(
    (t) => isLive(t) && (!t.done || (t.completedAt !== null && new Date(t.completedAt).getTime() >= dayStart)),
  );
}

export function sortByDue(tasks: readonly Task[]): Task[] {
  return [...tasks].sort((a, b) => compareDue(a.due, b.due) || a.createdAt.localeCompare(b.createdAt));
}

export function matchesDue(task: Task, filter: DueFilter, now: Date): boolean {
  if (filter === "any") return true;
  if (task.due === null) return false;
  if (filter === "today") return isDueToday(task.due, now);
  if (filter === "overdue") return !task.done && isOverdue(task.due, now);
  const day = dueDayKey(task.due);
  return day >= dateKey(now) && day <= dateKey(addDays(now, 6));
}

export function openCount(tasks: readonly Task[], listId: string): number {
  return tasks.filter((t) => isOpen(t) && t.listId === listId).length;
}

export interface TodayGroups {
  overdue: Task[];
  today: Task[];
  /** The next five days after today, with how many open tasks fall on each. */
  week: { date: Date; count: number }[];
  doneThisWeek: number;
}

export function groupToday(tasks: readonly Task[], now: Date): TodayGroups {
  const live = tasks.filter(isLive);
  const overdue = sortByDue(live.filter((t) => !t.done && t.due !== null && isOverdue(t.due, now)));
  const overdueIds = new Set(overdue.map((t) => t.id));
  const today = sortByDue(
    activeTasks(live, now).filter((t) => t.due !== null && isDueToday(t.due, now) && !overdueIds.has(t.id)),
  );
  const week = [1, 2, 3, 4, 5].map((n) => {
    const date = addDays(startOfDay(now), n);
    const key = dateKey(date);
    return { date, count: live.filter((t) => !t.done && t.due !== null && dueDayKey(t.due) === key).length };
  });
  const weekStart = startOfWeek(now).getTime();
  const doneThisWeek = live.filter((t) => t.done && t.completedAt !== null && new Date(t.completedAt).getTime() >= weekStart).length;
  return { overdue, today, week, doneThisWeek };
}
