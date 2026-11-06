import { addDays, compareDue, dateKey, dueDayKey, formatDue, isDueToday, isOverdue, parseDue, startOfDay, startOfWeek } from "../../lib/dates";
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
  /** The next five days after today, with the open tasks that fall on each. */
  week: { date: Date; tasks: Task[] }[];
  /** Open tasks due from today to six days on. */
  thisWeekOpen: number;
  doneThisWeek: number;
  /** Done this week plus open tasks due this week: the "N of M" in Progress. */
  weekTotal: number;
}

export function groupToday(tasks: readonly Task[], now: Date): TodayGroups {
  const live = tasks.filter(isLive);
  const open = live.filter((t) => !t.done && t.due !== null);
  const overdue = sortByDue(open.filter((t) => isOverdue(t.due!, now)));
  const overdueIds = new Set(overdue.map((t) => t.id));
  const today = sortByDue(
    activeTasks(live, now).filter((t) => t.due !== null && isDueToday(t.due, now) && !overdueIds.has(t.id)),
  );
  const week = [1, 2, 3, 4, 5].map((n) => {
    const date = addDays(startOfDay(now), n);
    const key = dateKey(date);
    return { date, tasks: sortByDue(open.filter((t) => dueDayKey(t.due!) === key)) };
  });
  const from = dateKey(now);
  const to = dateKey(addDays(now, 6));
  const thisWeekOpen = open.filter((t) => dueDayKey(t.due!) >= from && dueDayKey(t.due!) <= to).length;
  const weekStart = startOfWeek(now);
  // A repeating task counts once for each time it was completed; any other task once, when it was done.
  const since = weekStart.getTime();
  const doneThisWeek = live.reduce((n, t) => {
    if (t.repeat) return n + (t.completions ?? []).filter((c) => new Date(c).getTime() >= since).length;
    return n + (t.done && t.completedAt !== null && new Date(t.completedAt).getTime() >= since ? 1 : 0);
  }, 0);
  const monday = dateKey(weekStart);
  const sunday = dateKey(addDays(weekStart, 6));
  const openInWeek = open.filter((t) => dueDayKey(t.due!) >= monday && dueDayKey(t.due!) <= sunday).length;
  return { overdue, today, week, thisWeekOpen, doneThisWeek, weekTotal: doneThisWeek + openInWeek };
}

/** The count behind the Tasks badge: open tasks that are due or overdue. */
export function dueCount(tasks: readonly Task[], now: Date): number {
  return tasks.filter((t) => isOpen(t) && t.due !== null && (isOverdue(t.due, now) || isDueToday(t.due, now))).length;
}

/** The due text of a row: "Overdue 1d" for earlier days, otherwise "Today 12:00", "Mon 10". */
export function dueText(task: Task, now: Date): string {
  if (!task.due) return "";
  if (!task.done && isOverdue(task.due, now)) {
    const days = Math.round((startOfDay(now).getTime() - startOfDay(parseDue(task.due).date).getTime()) / 86_400_000);
    if (days > 0) return `Overdue ${days}d`;
  }
  return formatDue(task.due, now);
}

/** Whether the date is the amber kind: the person must act. */
export function needsAction(task: Task, now: Date): boolean {
  return !task.done && task.due !== null && (isOverdue(task.due, now) || isDueToday(task.due, now));
}

export interface TaskGroup {
  key: string;
  label: string;
  amber: boolean;
  tasks: Task[];
}

/** Overdue, Today, This week, Later and No date, each in due order. Finished tasks stay with their day. */
export function groupTasks(tasks: readonly Task[], now: Date): TaskGroup[] {
  const weekEnd = dateKey(addDays(now, 6));
  const today = dateKey(now);
  const buckets: Record<string, Task[]> = { overdue: [], today: [], week: [], later: [], none: [] };
  for (const t of sortByDue(tasks)) {
    if (t.due === null) buckets.none!.push(t);
    else if (!t.done && isOverdue(t.due, now)) buckets.overdue!.push(t);
    else if (dueDayKey(t.due) <= today) buckets.today!.push(t);
    else if (dueDayKey(t.due) <= weekEnd) buckets.week!.push(t);
    else buckets.later!.push(t);
  }
  const defs: [string, string, boolean][] = [
    ["overdue", "Overdue", true],
    ["today", "Today (planned or due)", false],
    ["week", "This week", false],
    ["later", "Later", false],
    ["none", "No date", false],
  ];
  return defs.map(([key, label, amber]) => ({ key, label, amber, tasks: buckets[key]! })).filter((g) => g.tasks.length > 0);
}
