export type Priority = "none" | "low" | "medium" | "high";
export const PRIORITIES: readonly Priority[] = ["none", "low", "medium", "high"];

/** Eight fixed content colours; a person's list colour is content, not interface. */
export const LIST_COLOURS = ["c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8"] as const;
export type ListColour = (typeof LIST_COLOURS)[number];

export interface ChecklistItem {
  id: string;
  title: string;
  done: boolean;
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
  createdAt: string;
  updatedAt: string;
}

export interface TaskList {
  id: string;
  name: string;
  colour: ListColour;
  isInbox: boolean;
}

export type RecordType = "task" | "list";
export type OutboxOp = "create" | "update" | "delete" | "purge";

/** A local change not yet sent to the engine. */
export interface OutboxEntry {
  seq: number;
  type: RecordType;
  id: string;
  op: OutboxOp;
  at: string;
}

export interface PlannerState {
  ready: boolean;
  tasks: readonly Task[];
  lists: readonly TaskList[];
  outbox: readonly OutboxEntry[];
}

export interface NewTask {
  title: string;
  notes?: string;
  listId?: string;
  due?: string | null;
  priority?: Priority;
  checklist?: ChecklistItem[];
}

export type TaskPatch = Partial<Pick<Task, "title" | "notes" | "listId" | "due" | "priority" | "checklist">>;
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
}
