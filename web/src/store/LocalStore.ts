import { MemoryPersistence, defaultPersistence, type PersistOp, type Persistence } from "./persistence";
import {
  RESTORE_DAYS,
  type ListColour,
  type ListPatch,
  type NewTask,
  type OutboxEntry,
  type OutboxOp,
  type PlannerState,
  type PlannerStore,
  type RecordType,
  type Task,
  type TaskList,
  type TaskPatch,
} from "./types";

export interface LocalStoreOptions {
  persistence?: Persistence;
  now?: () => Date;
  newId?: () => string;
}

interface Change {
  tasks?: Task[];
  removed?: string[];
  lists?: TaskList[];
  entries: [RecordType, string, OutboxOp][];
}

export class LocalStore implements PlannerStore {
  readonly ready: Promise<void>;
  private state: PlannerState = { ready: false, tasks: [], lists: [], outbox: [] };
  private listeners = new Set<() => void>();
  private persistence: Persistence;
  private writes: Promise<void> = Promise.resolve();
  private readonly now: () => Date;
  private readonly newId: () => string;

  constructor(options: LocalStoreOptions = {}) {
    this.persistence = options.persistence ?? defaultPersistence();
    this.now = options.now ?? (() => new Date());
    this.newId = options.newId ?? (() => crypto.randomUUID());
    this.ready = this.load();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = (): PlannerState => this.state;

  /** Resolves once every write so far has reached the persistence layer. */
  flush(): Promise<void> {
    return this.writes;
  }

  pendingChanges(): number {
    return this.state.outbox.length;
  }

  private async load(): Promise<void> {
    let snapshot;
    try {
      snapshot = await this.persistence.load();
    } catch {
      // IndexedDB can be blocked or broken; carry on in memory for this visit.
      this.persistence = new MemoryPersistence();
      snapshot = await this.persistence.load();
    }
    this.state = { ready: true, tasks: snapshot.tasks, lists: snapshot.lists, outbox: snapshot.outbox };
    if (!this.state.lists.some((l) => l.isInbox)) {
      const inbox = this.makeList("Inbox", "c1", true);
      this.commit({ lists: [inbox], entries: [["list", inbox.id, "create"]] });
    }
    this.purgeDeleted();
    this.emit();
  }

  private makeList(name: string, colour: ListColour, isInbox: boolean): TaskList {
    return { id: this.newId(), name, colour, isInbox };
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  private assertReady(): void {
    if (!this.state.ready) throw new Error("The store is still loading");
  }

  /** Applies a change, records it in the outbox and writes it through. */
  private commit(change: Change): void {
    const at = this.now().toISOString();
    let seq = this.state.outbox.reduce((max, e) => Math.max(max, e.seq), 0);
    const ops: PersistOp[] = [];

    const tasks = new Map(this.state.tasks.map((t) => [t.id, t]));
    for (const t of change.tasks ?? []) {
      tasks.set(t.id, t);
      ops.push({ store: "tasks", put: t });
    }
    for (const id of change.removed ?? []) {
      tasks.delete(id);
      ops.push({ store: "tasks", delete: id });
    }

    const lists = [...this.state.lists];
    for (const list of change.lists ?? []) {
      const i = lists.findIndex((l) => l.id === list.id);
      if (i >= 0) lists[i] = list;
      else lists.push(list);
      ops.push({ store: "lists", put: list });
    }

    const outbox = [...this.state.outbox];
    for (const [type, id, op] of change.entries) {
      const entry: OutboxEntry = { seq: ++seq, type, id, op, at };
      outbox.push(entry);
      ops.push({ store: "outbox", put: entry });
    }

    this.state = { ...this.state, tasks: [...tasks.values()], lists, outbox };
    this.writes = this.writes.then(() => this.persistence.write(ops)).catch(() => undefined);
    this.emit();
  }

  private task(id: string): Task {
    const found = this.state.tasks.find((t) => t.id === id);
    if (!found) throw new Error(`No task ${id}`);
    return found;
  }

  private change(id: string, op: OutboxOp, apply: (t: Task) => Partial<Task>): void {
    this.assertReady();
    const current = this.task(id);
    const updated: Task = { ...current, ...apply(current), updatedAt: this.now().toISOString() };
    this.commit({ tasks: [updated], entries: [["task", id, op]] });
  }

  addTask(input: NewTask): Task {
    this.assertReady();
    const inbox = this.state.lists.find((l) => l.isInbox);
    const stamp = this.now().toISOString();
    const task: Task = {
      id: this.newId(),
      title: input.title.trim(),
      notes: input.notes ?? "",
      listId: input.listId ?? inbox!.id,
      due: input.due ?? null,
      priority: input.priority ?? "none",
      done: false,
      completedAt: null,
      deletedAt: null,
      checklist: input.checklist ?? [],
      createdAt: stamp,
      updatedAt: stamp,
    };
    this.commit({ tasks: [task], entries: [["task", task.id, "create"]] });
    return task;
  }

  updateTask(id: string, patch: TaskPatch): void {
    this.change(id, "update", () => patch);
  }

  setDone(id: string, done: boolean): void {
    this.change(id, "update", () => ({ done, completedAt: done ? this.now().toISOString() : null }));
  }

  deleteTask(id: string): void {
    this.change(id, "delete", () => ({ deletedAt: this.now().toISOString() }));
  }

  restoreTask(id: string): void {
    this.change(id, "update", () => ({ deletedAt: null }));
  }

  purgeDeleted(): number {
    const cutoff = this.now().getTime() - RESTORE_DAYS * 86_400_000;
    const old = this.state.tasks.filter((t) => t.deletedAt !== null && new Date(t.deletedAt).getTime() < cutoff);
    if (old.length === 0) return 0;
    this.commit({ removed: old.map((t) => t.id), entries: old.map((t) => ["task", t.id, "purge"]) });
    return old.length;
  }

  addList(name: string, colour: ListColour): TaskList {
    this.assertReady();
    const list = this.makeList(name.trim(), colour, false);
    this.commit({ lists: [list], entries: [["list", list.id, "create"]] });
    return list;
  }

  updateList(id: string, patch: ListPatch): void {
    this.assertReady();
    const current = this.state.lists.find((l) => l.id === id);
    if (!current) throw new Error(`No list ${id}`);
    const next: TaskList = { ...current, ...patch, name: (patch.name ?? current.name).trim() };
    this.commit({ lists: [next], entries: [["list", id, "update"]] });
  }
}
