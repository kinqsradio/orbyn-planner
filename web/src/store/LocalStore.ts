import { coalesce, refKey, type Patch, type Ref } from "./outbox";
import { defaultPersistence, type ApplyResult, type Persistence } from "./persistence";
import {
  RESTORE_DAYS,
  type ListColour,
  type ListPatch,
  type NewTask,
  type OutboxEntry,
  type PersistenceState,
  type PlannerState,
  type PlannerStore,
  type RecordType,
  type Task,
  type TaskList,
  type TaskPatch,
} from "./types";

/** Every tab makes the Inbox with this id, so two tabs starting together still end with one. */
export const INBOX_ID = "inbox";
export const CHANNEL_NAME = "orbyn-planner";
const DAY_MS = 86_400_000;

export interface LocalStoreOptions {
  persistence?: Persistence;
  now?: () => Date;
  newId?: () => string;
  /** Called when another tab upgrades the database and this one must start over. Defaults to a page reload. */
  onReload?: () => void;
  /** Tell other tabs about writes. Defaults to on where BroadcastChannel exists. */
  broadcast?: boolean;
}

type PatchInput = Patch extends infer P ? (P extends Patch ? Omit<P, "key"> : never) : never;
type AnyRecord = Task | TaskList;

function describe(error: unknown, doing: "write" | "open"): string {
  const name = error instanceof DOMException || error instanceof Error ? error.name : "";
  if (name === "QuotaExceededError") return "This device is out of storage.";
  return doing === "open" ? "Couldn’t open this device’s storage." : "Couldn’t write to this device’s storage.";
}

export class LocalStore implements PlannerStore {
  readonly ready: Promise<void>;
  private state: PlannerState = { ready: false, tasks: [], lists: [], outbox: [], persistence: { status: "ok" } };
  private listeners = new Set<() => void>();
  private persistence: Persistence;
  private writes: Promise<void> = Promise.resolve();
  /** False when storage could not be opened: changes then stay on screen, marked as not saved. */
  private writable = true;
  private provisional = 0;
  private pending = new Map<string, number>();
  private channel: BroadcastChannel | null = null;
  private readonly tab = Math.random().toString(36).slice(2);
  private readonly now: () => Date;
  private readonly newId: () => string;

  constructor(options: LocalStoreOptions = {}) {
    this.persistence = options.persistence ?? defaultPersistence();
    this.now = options.now ?? (() => new Date());
    this.newId = options.newId ?? (() => crypto.randomUUID());
    this.state = { ...this.state, persistence: this.persistence.durable ? { status: "ok" } : { status: "memory" } };

    const reload = options.onReload ?? (() => window.location.reload());
    this.persistence.setHandlers({
      onVersionChange: () => {
        this.setPersistence({ status: "failed", reason: "Another tab updated Orbyn Planner. This page will reload." });
        reload();
      },
      onBlocked: () => this.setPersistence({ status: "failed", reason: "Close the other Orbyn Planner tabs to finish updating." }),
    });
    if ((options.broadcast ?? true) && typeof BroadcastChannel !== "undefined") {
      this.channel = new BroadcastChannel(CHANNEL_NAME);
      this.channel.onmessage = (event: MessageEvent<{ tab: string; refs: Ref[] }>) => {
        if (event.data.tab !== this.tab) void this.refresh(event.data.refs);
      };
    }
    this.ready = this.load();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = (): PlannerState => this.state;

  /** Resolves once every write so far has been tried. */
  flush(): Promise<void> {
    return this.writes;
  }

  /** Stops listening to other tabs. */
  close(): void {
    this.channel?.close();
    this.channel = null;
  }

  pendingChanges(): number {
    return this.state.outbox.length;
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  private setPersistence(next: PersistenceState): void {
    this.state = { ...this.state, persistence: next };
    this.emit();
  }

  private assertReady(): void {
    if (!this.state.ready) throw new Error("The store is still loading");
  }

  private async load(): Promise<void> {
    let snapshot = { tasks: [] as Task[], lists: [] as TaskList[], outbox: [] as OutboxEntry[] };
    let persistence = this.state.persistence;
    try {
      snapshot = await this.persistence.load();
      if (persistence.status === "failed") persistence = this.persistence.durable ? { status: "ok" } : { status: "memory" };
    } catch (error) {
      // Not a quiet fall-back to memory: the person is told, and nothing is written over what is there.
      this.writable = false;
      persistence = { status: "failed", reason: describe(error, "open") };
    }
    this.state = { ready: true, ...snapshot, persistence };
    if (!this.state.lists.some((l) => l.isInbox)) {
      const inbox: TaskList = { id: INBOX_ID, name: "Inbox", colour: "c1", isInbox: true };
      this.commit([{ type: "list", id: inbox.id, op: "create", record: inbox }]);
    }
    this.purgeDeleted();
    this.emit();
  }

  // Records in memory ---------------------------------------------------------------------------

  private replaceRecord(type: RecordType, id: string, record: AnyRecord | null): void {
    const key = type === "task" ? "tasks" : "lists";
    const list = [...(this.state[key] as readonly AnyRecord[])];
    const index = list.findIndex((r) => r.id === id);
    if (record === null) {
      if (index >= 0) list.splice(index, 1);
    } else if (index >= 0) {
      list[index] = record; // a changed record keeps its place
    } else {
      list.push(record);
    }
    this.state = { ...this.state, [key]: list };
  }

  private current(type: RecordType, id: string): AnyRecord | undefined {
    return (type === "task" ? this.state.tasks : this.state.lists).find((r) => r.id === id);
  }

  private setOutbox(type: RecordType, id: string, entry: OutboxEntry | null): void {
    const rest = this.state.outbox.filter((e) => !(e.type === type && e.id === id));
    this.state = { ...this.state, outbox: entry ? [...rest, entry] : rest };
  }

  /** Applies patches to what is on screen, as the write will apply them in storage. */
  private applyLocal(patches: Patch[], at: string): void {
    for (const p of patches) {
      if (p.op === "create") {
        if (this.current(p.type, p.id)) continue;
        this.replaceRecord(p.type, p.id, p.record);
      } else if (p.op === "purge") {
        this.replaceRecord(p.type, p.id, null);
      } else {
        const record = this.current(p.type, p.id);
        if (!record) continue;
        this.replaceRecord(p.type, p.id, { ...record, ...p.fields } as AnyRecord);
      }
      const existing = this.state.outbox.find((e) => e.type === p.type && e.id === p.id);
      const change = coalesce(existing, p, at);
      if (change.write) {
        this.setOutbox(p.type, p.id, { ...change.write, seq: change.write.seq || -++this.provisional });
      } else if (change.remove !== undefined) {
        this.setOutbox(p.type, p.id, null);
      }
    }
  }

  /** Takes storage's version of records, except ones with a write still on its way. */
  private reconcile(result: ApplyResult): void {
    for (const r of result.records) {
      if (this.pending.get(refKey(r))) continue;
      this.replaceRecord(r.type, r.id, r.record);
    }
    for (const o of result.outbox) {
      if (this.pending.get(refKey(o))) continue;
      this.setOutbox(o.type, o.id, o.entry);
    }
    this.emit();
  }

  private async refresh(refs: Ref[]): Promise<void> {
    try {
      this.reconcile(await this.persistence.read(refs));
    } catch {
      // The next write or reload will say if storage is broken.
    }
  }

  /** Makes a change: on screen now, in storage and the outbox next, and tells other tabs. */
  private commit(inputs: PatchInput[]): void {
    const at = this.now().toISOString();
    const patches = inputs.map((p) => ({ ...p, key: this.newId() }) as Patch);
    this.applyLocal(patches, at);
    this.emit();
    if (!this.writable) return;
    for (const p of patches) this.pending.set(refKey(p), (this.pending.get(refKey(p)) ?? 0) + 1);
    this.writes = this.writes.then(async () => {
      try {
        const result = await this.persistence.apply({ at, patches });
        for (const p of patches) this.pending.set(refKey(p), (this.pending.get(refKey(p)) ?? 1) - 1);
        this.reconcile(result);
        this.channel?.postMessage({ tab: this.tab, refs: patches.map((p) => ({ type: p.type, id: p.id })) });
      } catch (error) {
        for (const p of patches) this.pending.set(refKey(p), (this.pending.get(refKey(p)) ?? 1) - 1);
        // Stays failed until the page is reloaded: the changes on screen did not reach storage.
        this.setPersistence({ status: "failed", reason: describe(error, "write") });
      }
    });
  }

  // Tasks ---------------------------------------------------------------------------------------

  private task(id: string): Task {
    const found = this.state.tasks.find((t) => t.id === id);
    if (!found) throw new Error(`No task ${id}`);
    return found;
  }

  private change(id: string, op: "update" | "delete", fields: Record<string, unknown>): void {
    this.assertReady();
    this.task(id);
    this.commit([{ type: "task", id, op, fields: { ...fields, updatedAt: this.now().toISOString() } }]);
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
    this.commit([{ type: "task", id: task.id, op: "create", record: task }]);
    return task;
  }

  updateTask(id: string, patch: TaskPatch): void {
    this.change(id, "update", { ...patch });
  }

  setDone(id: string, done: boolean): void {
    this.change(id, "update", { done, completedAt: done ? this.now().toISOString() : null });
  }

  deleteTask(id: string): void {
    this.change(id, "delete", { deletedAt: this.now().toISOString() });
  }

  restoreTask(id: string): void {
    this.change(id, "update", { deletedAt: null });
  }

  /**
   * Removes tasks deleted more than 30 days ago for good, leaving a delete entry in the outbox.
   * It does nothing when this device's clock is more than a day past the newest record it holds: a
   * clock set far ahead would otherwise wipe the whole Deleted list. After a long idle spell the
   * purge simply waits for the next change that brings the newest timestamp up to date.
   */
  purgeDeleted(): number {
    const stamps = [
      ...this.state.tasks.flatMap((t) => [t.createdAt, t.updatedAt, t.completedAt, t.deletedAt]),
      ...this.state.outbox.flatMap((e) => [e.createdAt, e.updatedAt]),
    ]
      .filter((s): s is string => s !== null)
      .map((s) => new Date(s).getTime());
    const newest = stamps.length ? Math.max(...stamps) : 0;
    if (this.now().getTime() - newest > DAY_MS) return 0;
    const cutoff = this.now().getTime() - RESTORE_DAYS * DAY_MS;
    const old = this.state.tasks.filter((t) => t.deletedAt !== null && new Date(t.deletedAt).getTime() < cutoff);
    if (old.length === 0) return 0;
    this.commit(old.map((t) => ({ type: "task" as const, id: t.id, op: "purge" as const })));
    return old.length;
  }

  // Lists ---------------------------------------------------------------------------------------

  addList(name: string, colour: ListColour): TaskList {
    this.assertReady();
    const list: TaskList = { id: this.newId(), name: name.trim(), colour, isInbox: false };
    this.commit([{ type: "list", id: list.id, op: "create", record: list }]);
    return list;
  }

  updateList(id: string, patch: ListPatch): void {
    this.assertReady();
    const current = this.state.lists.find((l) => l.id === id);
    if (!current) throw new Error(`No list ${id}`);
    const fields: Record<string, unknown> = { ...patch };
    if (patch.name !== undefined) fields.name = patch.name.trim() || current.name;
    this.commit([{ type: "list", id, op: "update", fields }]);
  }
}
