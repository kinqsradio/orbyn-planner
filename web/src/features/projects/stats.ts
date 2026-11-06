import { compareDue } from "../../lib/dates";
import { inOrder } from "../../store/order";
import type { Project, Task } from "../../store/types";

export interface ProjectStats {
  total: number;
  done: number;
  /** Whole percent, 0 for a project with no tasks. */
  percent: number;
  /** The open task due soonest (undated last), or null. */
  next: Task | null;
}

/** The tasks of a project that are not deleted. */
export const tasksOf = (tasks: readonly Task[], projectId: string): Task[] =>
  tasks.filter((t) => t.deletedAt === null && t.projectId === projectId);

export function projectStats(tasks: readonly Task[], projectId: string): ProjectStats {
  const mine = tasksOf(tasks, projectId);
  const done = mine.filter((t) => t.done).length;
  const open = mine.filter((t) => !t.done).sort((a, b) => compareDue(a.due, b.due) || a.createdAt.localeCompare(b.createdAt));
  return { total: mine.length, done, percent: mine.length === 0 ? 0 : Math.round((done / mine.length) * 100), next: open[0] ?? null };
}

export interface Lane {
  /** The section id, or null for "No section". */
  sectionId: string | null;
  name: string;
  tasks: Task[];
}

/** A project's tasks grouped by section in section order, with "No section" last. Unknown section ids count as none. */
export function groupBySection(project: Project, tasks: readonly Task[]): Lane[] {
  const mine = tasksOf(tasks, project.id).sort((a, b) => compareDue(a.due, b.due) || a.createdAt.localeCompare(b.createdAt));
  const known = new Set(project.sections.map((s) => s.id));
  const lanes: Lane[] = inOrder(project.sections).map((s) => ({ sectionId: s.id, name: s.name, tasks: mine.filter((t) => t.sectionId === s.id) }));
  const loose = mine.filter((t) => t.sectionId === null || !known.has(t.sectionId));
  if (loose.length > 0 || lanes.length === 0) lanes.push({ sectionId: null, name: lanes.length === 0 ? "Tasks" : "No section", tasks: loose });
  return lanes;
}
