import { coalesce, refKey, type AnyRecord, type PatchBatch, type Ref } from "./outbox";
import type { CalendarEvent, OutboxEntry, PlannerCalendar, Project, RecordType, Task, TaskList } from "./types";

export interface Snapshot {
  tasks: Task[];
  lists: TaskList[];
  events: CalendarEvent[];
  calendars: PlannerCalendar[];
  projects: Project[];
  outbox: OutboxEntry[];
}

/** The records a write or a read touched, as they now are in storage, and their outbox entries. */
export interface ApplyResult {
  /** `record` is null for a record that is gone. */
  records: { type: RecordType; id: string; record: AnyRecord | null }[];
  outbox: { type: RecordType; id: string; entry: OutboxEntry | null }[];
}

/** An outbox entry that reached the server: cleared only if it is still the version that was sent. */
export interface Acknowledged {
  type: RecordType;
  id: string;
  idempotencyKey: string;
}

export interface PersistenceHandlers {
  /** Another tab wants to upgrade the database; this connection has been closed. */
  onVersionChange?: () => void;
  /** An upgrade is waiting for other tabs to close their connections. */
  onBlocked?: () => void;
}

export interface Persistence {
  /** False when nothing outlives this visit. */
  readonly durable: boolean;
  load(): Promise<Snapshot>;
  /**
   * Applies patches as patches: in one transaction each record is read, only the changed fields are
   * written, and its outbox entry is folded in. Nothing here relies on this tab's copy being current.
   */
  apply(batch: PatchBatch): Promise<ApplyResult>;
  /** The current state of some records, after another tab changed them. */
  read(refs: Ref[]): Promise<ApplyResult>;
  /**
   * Clears outbox entries the server has acknowledged. An entry edited since it was sent has a new
   * idempotency key and stays, so a change made while an upload was out is never lost.
   */
  acknowledge(sent: Acknowledged[]): Promise<ApplyResult>;
  setHandlers(handlers: PersistenceHandlers): void;
  /** Lets go of the storage connection (none to let go of in memory). */
  close?(): void;
}

const STORE_OF: Record<RecordType, "tasks" | "lists" | "events" | "calendars" | "projects"> = { task: "tasks", list: "lists", event: "events", calendar: "calendars", project: "projects" };
const storeOf = (type: RecordType) => STORE_OF[type];

/** Keeps everything in memory. Used where IndexedDB does not exist, and in tests. */
export class MemoryPersistence implements Persistence {
  private records = new Map<string, AnyRecord>();
  private outbox = new Map<string, OutboxEntry>();
  private nextSeq = 1;

  /** `volatile` marks a store that stands in for missing IndexedDB, so the app can say nothing is saved. */
  constructor(private readonly options: { volatile?: boolean } = {}) {}

  get durable(): boolean {
    return !this.options.volatile;
  }

  setHandlers(): void {}

  async load(): Promise<Snapshot> {
    const all = [...this.records.entries()];
    return {
      tasks: all.filter(([k]) => k.startsWith("task:")).map(([, v]) => v as Task),
      lists: all.filter(([k]) => k.startsWith("list:")).map(([, v]) => v as TaskList),
      events: all.filter(([k]) => k.startsWith("event:")).map(([, v]) => v as CalendarEvent),
      calendars: all.filter(([k]) => k.startsWith("calendar:")).map(([, v]) => v as PlannerCalendar),
      projects: all.filter(([k]) => k.startsWith("project:")).map(([, v]) => v as Project),
      outbox: [...this.outbox.values()].sort((a, b) => a.seq - b.seq),
    };
  }

  async apply(batch: PatchBatch): Promise<ApplyResult> {
    const result: ApplyResult = { records: [], outbox: [] };
    for (const p of batch.patches) {
      const key = refKey(p);
      let record: AnyRecord | null = this.records.get(key) ?? null;
      if (p.op === "create") {
        if (record) {
          result.records.push({ type: p.type, id: p.id, record });
          continue; // already there, perhaps from another tab: leave it
        }
        record = p.record;
        this.records.set(key, record);
      } else if (p.op === "purge") {
        this.records.delete(key);
        record = null;
      } else {
        if (!record) continue;
        record = { ...record, ...p.fields } as AnyRecord;
        this.records.set(key, record);
      }
      result.records.push({ type: p.type, id: p.id, record });

      if (p.local) continue;
      const existing = this.outbox.get(key);
      const change = coalesce(existing, p, batch.at);
      if (change.remove !== undefined) this.outbox.delete(key);
      let entry: OutboxEntry | null = existing && change.remove === undefined ? existing : null;
      if (change.write) {
        entry = { ...change.write, seq: change.write.seq || this.nextSeq++ };
        this.outbox.set(key, entry);
      }
      result.outbox.push({ type: p.type, id: p.id, entry });
    }
    return result;
  }

  async acknowledge(sent: Acknowledged[]): Promise<ApplyResult> {
    const result: ApplyResult = { records: [], outbox: [] };
    for (const a of sent) {
      const key = refKey(a);
      const existing = this.outbox.get(key);
      if (existing && existing.idempotencyKey === a.idempotencyKey) this.outbox.delete(key);
      result.outbox.push({ type: a.type, id: a.id, entry: this.outbox.get(key) ?? null });
    }
    return result;
  }

  async read(refs: Ref[]): Promise<ApplyResult> {
    return {
      records: refs.map((r) => ({ ...r, record: this.records.get(refKey(r)) ?? null })),
      outbox: refs.map((r) => ({ ...r, entry: this.outbox.get(refKey(r)) ?? null })),
    };
  }
}

/** The planner kept on this device alone; each account has a database of its own (see `planners.ts`). */
export const DEVICE_DB = "orbyn-planner";
const DB_VERSION = 4;

type Rec = AnyRecord & Record<string, unknown>;
const ALL_STORES = ["tasks", "lists", "events", "calendars", "projects", "outbox"];

/** One IndexedDB object store per record type, and an outbox keyed by an auto-incrementing number. */
export class IdbPersistence implements Persistence {
  readonly durable = true;

  constructor(private readonly dbName: string = DEVICE_DB) {}

  private db: Promise<IDBDatabase> | null = null;
  private handlers: PersistenceHandlers = {};

  setHandlers(handlers: PersistenceHandlers): void {
    this.handlers = handlers;
  }

  /** Lets go of the connection, so the database can be deleted. */
  close(): void {
    const pending = this.db;
    this.db = null;
    void pending?.then((db) => db.close(), () => undefined);
  }

  private open(): Promise<IDBDatabase> {
    this.db ??= new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, DB_VERSION);
      req.onupgradeneeded = (event) => {
        const db = req.result;
        for (const name of ["tasks", "lists", "events", "calendars", "projects"]) {
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: "id" });
        }
        // Version 1 keyed the outbox by a number made in memory, which two tabs would reuse.
        if (event.oldVersion > 0 && event.oldVersion < 2 && db.objectStoreNames.contains("outbox")) db.deleteObjectStore("outbox");
        if (!db.objectStoreNames.contains("outbox")) {
          const outbox = db.createObjectStore("outbox", { keyPath: "seq", autoIncrement: true });
          outbox.createIndex("record", ["type", "id"], { unique: true });
        }
      };
      req.onblocked = () => this.handlers.onBlocked?.();
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => {
          db.close();
          this.db = null;
          this.handlers.onVersionChange?.();
        };
        resolve(db);
      };
      req.onerror = () => {
        this.db = null;
        reject(req.error);
      };
    });
    return this.db;
  }

  async load(): Promise<Snapshot> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(ALL_STORES, "readonly");
      const out: Snapshot = { tasks: [], lists: [], events: [], calendars: [], projects: [], outbox: [] };
      tx.objectStore("tasks").getAll().onsuccess = (e) => (out.tasks = (e.target as IDBRequest<Task[]>).result);
      tx.objectStore("lists").getAll().onsuccess = (e) => (out.lists = (e.target as IDBRequest<TaskList[]>).result);
      tx.objectStore("events").getAll().onsuccess = (e) => (out.events = (e.target as IDBRequest<CalendarEvent[]>).result);
      tx.objectStore("calendars").getAll().onsuccess = (e) => (out.calendars = (e.target as IDBRequest<PlannerCalendar[]>).result);
      tx.objectStore("projects").getAll().onsuccess = (e) => (out.projects = (e.target as IDBRequest<Project[]>).result);
      tx.objectStore("outbox").getAll().onsuccess = (e) => (out.outbox = (e.target as IDBRequest<OutboxEntry[]>).result.sort((a, b) => a.seq - b.seq));
      tx.oncomplete = () => resolve(out);
      tx.onerror = tx.onabort = () => reject(tx.error ?? new Error("The read was aborted"));
    });
  }

  async apply(batch: PatchBatch): Promise<ApplyResult> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(ALL_STORES, "readwrite");
      const result: ApplyResult = { records: [], outbox: [] };
      tx.oncomplete = () => resolve(result);
      tx.onerror = tx.onabort = () => reject(tx.error ?? new Error("The write was aborted"));
      const outbox = tx.objectStore("outbox");
      const byRecord = outbox.index("record");

      // Callback style on purpose: every request is issued from the previous one's success handler,
      // so the transaction never sits idle between steps.
      const run = (i: number): void => {
        const p = batch.patches[i];
        if (!p) return;
        const store = tx.objectStore(storeOf(p.type));

        const foldOutbox = (record: AnyRecord | null) => {
          result.records.push({ type: p.type, id: p.id, record });
          if (p.local) return run(i + 1);
          byRecord.get([p.type, p.id]).onsuccess = (e) => {
            const existing = (e.target as IDBRequest<OutboxEntry | undefined>).result;
            const change = coalesce(existing, p, batch.at);
            if (change.remove !== undefined) outbox.delete(change.remove);
            let entry: OutboxEntry | null = existing && change.remove === undefined ? existing : null;
            const done = () => {
              result.outbox.push({ type: p.type, id: p.id, entry });
              run(i + 1);
            };
            const write = change.write;
            if (!write) return done();
            if (write.seq > 0) {
              entry = write;
              outbox.put(write).onsuccess = done;
            } else {
              const { seq: _unused, ...body } = write;
              void _unused;
              outbox.add(body).onsuccess = (ev) => {
                entry = { ...write, seq: (ev.target as IDBRequest<number>).result };
                done();
              };
            }
          };
        };

        if (p.op === "create") {
          store.get(p.id).onsuccess = (e) => {
            const current = (e.target as IDBRequest<AnyRecord | undefined>).result;
            if (current) {
              // Already there, perhaps made by another tab: leave it alone.
              result.records.push({ type: p.type, id: p.id, record: current });
              return run(i + 1);
            }
            store.put(p.record).onsuccess = () => foldOutbox(p.record);
          };
        } else if (p.op === "purge") {
          store.delete(p.id).onsuccess = () => foldOutbox(null);
        } else {
          store.get(p.id).onsuccess = (e) => {
            const current = (e.target as IDBRequest<Rec | undefined>).result;
            if (!current) return run(i + 1); // purged elsewhere
            const next = { ...current, ...p.fields } as Rec;
            store.put(next).onsuccess = () => foldOutbox(next);
          };
        }
      };
      run(0);
    });
  }

  async acknowledge(sent: Acknowledged[]): Promise<ApplyResult> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("outbox", "readwrite");
      const result: ApplyResult = { records: [], outbox: [] };
      const outbox = tx.objectStore("outbox");
      for (const a of sent) {
        outbox.index("record").get([a.type, a.id]).onsuccess = (e) => {
          const existing = (e.target as IDBRequest<OutboxEntry | undefined>).result;
          if (existing && existing.idempotencyKey === a.idempotencyKey) {
            outbox.delete(existing.seq);
            result.outbox.push({ type: a.type, id: a.id, entry: null });
          } else {
            result.outbox.push({ type: a.type, id: a.id, entry: existing ?? null });
          }
        };
      }
      tx.oncomplete = () => resolve(result);
      tx.onerror = tx.onabort = () => reject(tx.error ?? new Error("The write was aborted"));
    });
  }

  async read(refs: Ref[]): Promise<ApplyResult> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(ALL_STORES, "readonly");
      const result: ApplyResult = { records: [], outbox: [] };
      for (const r of refs) {
        tx.objectStore(storeOf(r.type)).get(r.id).onsuccess = (e) =>
          result.records.push({ ...r, record: (e.target as IDBRequest<AnyRecord | undefined>).result ?? null });
        tx.objectStore("outbox").index("record").get([r.type, r.id]).onsuccess = (e) =>
          result.outbox.push({ ...r, entry: (e.target as IDBRequest<OutboxEntry | undefined>).result ?? null });
      }
      tx.oncomplete = () => resolve(result);
      tx.onerror = tx.onabort = () => reject(tx.error ?? new Error("The read was aborted"));
    });
  }
}

/** IndexedDB where it exists, else memory that says so. */
export function defaultPersistence(dbName: string = DEVICE_DB): Persistence {
  return typeof indexedDB === "undefined" ? new MemoryPersistence({ volatile: true }) : new IdbPersistence(dbName);
}
