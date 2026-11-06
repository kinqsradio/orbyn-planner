import type { Repeat, Series } from "./repeat";

export type Priority = "none" | "low" | "medium" | "high";
export const PRIORITIES: readonly Priority[] = ["none", "low", "medium", "high"];

/** The four content colours of the designs; a person's list colour is content, not interface. */
export const LIST_COLOURS = ["c1", "c2", "c3", "c4"] as const;
export type ListColour = (typeof LIST_COLOURS)[number];

export interface ChecklistItem {
  id: string;
  title: string;
  done: boolean;
  /** Position among the steps, a fractional key (see order.ts): a step inserted anywhere changes no other. */
  order: string;
}

export interface Task {
  id: string;
  title: string;
  notes: string;
  listId: string;
  /** `YYYY-MM-DD` or `YYYY-MM-DDTHH:mm`, local time; null when undated. */
  due: string | null;
  priority: Priority;
  done: boolean;
  completedAt: string | null;
  /** Set when deleted; the task can be put back for 30 days. */
  deletedAt: string | null;
  checklist: ChecklistItem[];
  /** The project and section the task belongs to, if any. */
  projectId: string | null;
  sectionId: string | null;
  /** The engine's Series shape; its start is the date of the first due. The task's `due` is the current occurrence. */
  repeat: Series | null;
  /** Minutes before the due time to remind (0 is at the due time), or null. A date-only due reminds at 09:00. */
  reminder: number | null;
  /** When a repeating task was completed, most recent last. Feeds "Done this week". */
  completions: string[];
  /** Set on the one-off copy made by "This task" on a repeating task: which date of which task it replaces. */
  overrideOf: { id: string; date: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskList {
  id: string;
  name: string;
  colour: ListColour;
  isInbox: boolean;
}

export type RecordType = "task" | "list" | "event" | "calendar" | "project";
export type OutboxOp = "create" | "update" | "delete";

/**
 * A local change not yet sent to the engine. There is one entry per record: later edits of the
 * same record are folded into it, so "N changes waiting" counts records.
 */
export interface OutboxEntry {
  /** The key IndexedDB allocated for the entry. Negative while the write is still in flight. */
  seq: number;
  type: RecordType;
  id: string;
  /** "create" while the record has never been sent, otherwise the latest kind of change. */
  op: OutboxOp;
  /** Field names and their latest values (the whole record for a create). Empty for a purge. */
  changedFields: Record<string, unknown>;
  /** Kept while entries are folded together, so a retried send is not applied twice. */
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
}

export type Response = "accepted" | "declined" | "tentative" | "none";

export interface Person {
  email: string;
  response: Response;
}

/**
 * An event. `start` and `end` are local: `YYYY-MM-DDTHH:mm`, or for an all-day event `YYYY-MM-DD`,
 * where `end` is the last day it covers. `repeat` has the engine's Series shape, its start being
 * the first occurrence's date; every occurrence lasts as long as the first.
 */
export interface CalendarEvent {
  id: string;
  title: string;
  calendarId: string;
  allDay: boolean;
  start: string;
  end: string;
  place: string;
  notes: string;
  people: Person[];
  /** Minutes before the start, or null for no reminder. */
  reminder: number | null;
  /**
   * The engine's Series. In storage the rule is one field and each skipped date its own field
   * (`repeat.skip.<date>`), so two devices that skip different dates both keep their skip.
   */
  repeat: Series | null;
  /** The time zone a subscribed event is written in, so each repeat keeps its wall time there. Null for your own events. */
  zone: string | null;
  /** Set on the one-off copy made by "This event" on a repeating event: which date of which event it replaces. */
  overrideOf: { id: string; date: string } | null;
  /** Events of a subscribed calendar cannot be changed here. */
  readOnly: boolean;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type CalendarKind =
  | { type: "local" }
  | { type: "subscribed"; url: string; lastRefreshed: string | null; error: string | null };

export interface PlannerCalendar {
  id: string;
  name: string;
  colour: ListColour;
  visible: boolean;
  kind: CalendarKind;
}

/** Whether changes reach this device's storage. */
export type PersistenceState =
  | { status: "ok" }
  /** IndexedDB does not exist here, so nothing outlives this visit. */
  | { status: "memory" }
  | { status: "failed"; reason: string };

export interface ProjectSection {
  id: string;
  name: string;
  /** Fractional key (see order.ts); sections sort by it, then by id. */
  order: string;
}

export interface Project {
  id: string;
  name: string;
  colour: ListColour;
  /** `YYYY-MM-DD` the project should be done by, or null. */
  goal: string | null;
  sections: ProjectSection[];
  /** Done: kept, but out of the Active list. */
  archived: boolean;
}

export interface PlannerState {
  ready: boolean;
  tasks: readonly Task[];
  lists: readonly TaskList[];
  events: readonly CalendarEvent[];
  calendars: readonly PlannerCalendar[];
  projects: readonly Project[];
  outbox: readonly OutboxEntry[];
  persistence: PersistenceState;
}

export interface NewTask {
  title: string;
  notes?: string;
  listId?: string;
  due?: string | null;
  priority?: Priority;
  checklist?: ChecklistItem[];
  projectId?: string | null;
  sectionId?: string | null;
  /** A rule; the series starts on the due date (today when there is none). */
  repeat?: Repeat | null;
  reminder?: number | null;
  overrideOf?: { id: string; date: string } | null;
}

export interface NewEvent {
  title: string;
  calendarId?: string;
  allDay?: boolean;
  start: string;
  end: string;
  place?: string;
  notes?: string;
  people?: Person[];
  reminder?: number | null;
  /** A rule; the series starts on the event's first day. */
  repeat?: Repeat | null;
  /** An existing series, kept as given (used when a series is split). */
  series?: Series | null;
  overrideOf?: { id: string; date: string } | null;
  zone?: string | null;
}

export type EventPatch = Partial<
  Pick<CalendarEvent, "title" | "calendarId" | "allDay" | "start" | "end" | "place" | "notes" | "people" | "reminder" | "repeat" | "overrideOf">
>;

/** One event read from a subscribed calendar's feed. */
export type FeedEvent = Pick<NewEvent, "title" | "allDay" | "start" | "end" | "place" | "notes" | "series" | "zone">;

export type CalendarPatch = Partial<Pick<PlannerCalendar, "name" | "colour" | "visible">>;

export type TaskPatch = Partial<
  Pick<Task, "title" | "notes" | "listId" | "due" | "priority" | "checklist" | "projectId" | "sectionId" | "repeat" | "reminder" | "completions">
>;

export interface NewProject {
  name: string;
  colour: ListColour;
  goal?: string | null;
}

export type ProjectPatch = Partial<Pick<Project, "name" | "colour" | "goal" | "archived">>;
export type ListPatch = Partial<Pick<TaskList, "name" | "colour">>;

export const RESTORE_DAYS = 30;

/** What the UI talks to. The Rust engine will implement the same shape. */
export interface PlannerStore {
  subscribe(listener: () => void): () => void;
  getState(): PlannerState;
  readonly ready: Promise<void>;
  pendingChanges(): number;

  addTask(input: NewTask): Task;
  updateTask(id: string, patch: TaskPatch): void;
  setDone(id: string, done: boolean): void;
  /** Soft delete: the task moves to Deleted and can be restored. */
  deleteTask(id: string): void;
  restoreTask(id: string): void;
  /** Permanently removes tasks deleted more than 30 days ago. Returns how many. */
  purgeDeleted(): number;

  addList(name: string, colour: ListColour): TaskList;
  updateList(id: string, patch: ListPatch): void;

  addProject(input: NewProject): Project;
  updateProject(id: string, patch: ProjectPatch): void;
  addSection(projectId: string, name: string): ProjectSection;
  renameSection(projectId: string, sectionId: string, name: string): void;
  moveSection(projectId: string, sectionId: string, direction: "up" | "down"): void;
  /** Removes the section; its tasks go to "No section". */
  deleteSection(projectId: string, sectionId: string): void;

  addEvent(input: NewEvent): CalendarEvent;
  updateEvent(id: string, patch: EventPatch): void;
  /** Soft delete, like a task: it can be put back for 30 days. */
  deleteEvent(id: string): void;
  restoreEvent(id: string): void;

  addCalendar(name: string, colour: ListColour): PlannerCalendar;
  addSubscription(name: string, colour: ListColour, url: string): PlannerCalendar;
  updateCalendar(id: string, patch: CalendarPatch): void;
  /** Replaces a subscribed calendar's events with a fresh read of its feed. Not a person's edit, so not in the outbox. */
  replaceFeedEvents(calendarId: string, events: FeedEvent[]): void;
  /** Records why a subscription could not be refreshed. */
  failSubscription(calendarId: string, error: string): void;
}
