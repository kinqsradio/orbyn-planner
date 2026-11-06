import type { CalendarEvent, PlannerCalendar, PlannerState, Project, Task, TaskList } from "../../store/types";

/** What the file says it is, so another program can tell it apart. */
export const EXPORT_FORMAT = "orbyn-planner-export";
/** Raised when a field is removed or changes meaning; adding a field does not. */
export const EXPORT_VERSION = 1;

/**
 * Everything in the planner on this device, for the account that is open: lists, tasks, projects with their
 * sections, calendars and events, and what is in the trash (deleted tasks and events, kept 30 days). It holds
 * no keys, tokens, sign-in details or sync state (the outbox of changes waiting to be sent is left out), and it
 * isn't encrypted. There are no tags in the planner yet, so there is nothing to export for them.
 */
export interface PlannerExport {
  format: typeof EXPORT_FORMAT;
  formatVersion: number;
  /** ISO time the file was made. */
  exportedAt: string;
  lists: TaskList[];
  tasks: Task[];
  projects: Project[];
  calendars: PlannerCalendar[];
  events: CalendarEvent[];
  trash: { tasks: Task[]; events: CalendarEvent[] };
}

export class ExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExportError";
  }
}

type Content = Pick<PlannerState, "lists" | "tasks" | "projects" | "calendars" | "events">;

export function buildExport(state: Content, exportedAt: string): PlannerExport {
  const kept = <T extends { deletedAt: string | null }>(all: readonly T[]) => all.filter((r) => r.deletedAt === null);
  const trashed = <T extends { deletedAt: string | null }>(all: readonly T[]) => all.filter((r) => r.deletedAt !== null);
  return {
    format: EXPORT_FORMAT,
    formatVersion: EXPORT_VERSION,
    exportedAt,
    lists: [...state.lists],
    tasks: kept(state.tasks),
    projects: [...state.projects],
    calendars: [...state.calendars],
    events: kept(state.events),
    trash: { tasks: trashed(state.tasks), events: trashed(state.events) },
  };
}

export const exportJson = (state: Content, exportedAt: string): string => `${JSON.stringify(buildExport(state, exportedAt), null, 2)}\n`;

/** Reads a file made by `exportJson`; refuses anything else, and a version newer than this one knows. */
export function readExport(text: string): PlannerExport {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ExportError("This isn’t an Orbyn Planner export.");
  }
  const d = data as Partial<PlannerExport> | null;
  if (!d || d.format !== EXPORT_FORMAT || typeof d.formatVersion !== "number") throw new ExportError("This isn’t an Orbyn Planner export.");
  if (d.formatVersion > EXPORT_VERSION) throw new ExportError("This export is from a newer version of Orbyn Planner.");
  const arrays = [d.lists, d.tasks, d.projects, d.calendars, d.events, d.trash?.tasks, d.trash?.events];
  if (!arrays.every(Array.isArray)) throw new ExportError("This Orbyn Planner export is missing part of the planner.");
  return d as PlannerExport;
}
