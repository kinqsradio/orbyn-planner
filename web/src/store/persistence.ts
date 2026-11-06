import type { CalendarEvent, OutboxEntry, PlannerCalendar, Task, TaskList } from "./types";

export interface Snapshot {
  tasks: Task[];
  lists: TaskList[];
  events: CalendarEvent[];
  calendars: PlannerCalendar[];
  outbox: OutboxEntry[];
}

export type PersistOp =
  | { store: "tasks"; put: Task }
  | { store: "tasks"; delete: string }
  | { store: "lists"; put: TaskList }
  | { store: "events"; put: CalendarEvent }
  | { store: "events"; delete: string }
  | { store: "calendars"; put: PlannerCalendar }
  | { store: "outbox"; put: OutboxEntry };

export interface Persistence {
  load(): Promise<Snapshot>;
  write(ops: PersistOp[]): Promise<void>;
}

/** Keeps everything in memory. Used when IndexedDB is unavailable, and in tests. */
export class MemoryPersistence implements Persistence {
  private tasks = new Map<string, Task>();
  private lists = new Map<string, TaskList>();
  private events = new Map<string, CalendarEvent>();
  private calendars = new Map<string, PlannerCalendar>();
  private outbox = new Map<number, OutboxEntry>();

  async load(): Promise<Snapshot> {
    return {
      tasks: [...this.tasks.values()],
      lists: [...this.lists.values()],
      events: [...this.events.values()],
      calendars: [...this.calendars.values()],
      outbox: [...this.outbox.values()].sort((a, b) => a.seq - b.seq),
    };
  }

  async write(ops: PersistOp[]): Promise<void> {
    for (const op of ops) {
      if (op.store === "tasks") {
        if ("delete" in op) this.tasks.delete(op.delete);
        else this.tasks.set(op.put.id, op.put);
      } else if (op.store === "lists") this.lists.set(op.put.id, op.put);
      else if (op.store === "events") {
        if ("delete" in op) this.events.delete(op.delete);
        else this.events.set(op.put.id, op.put);
      } else if (op.store === "calendars") this.calendars.set(op.put.id, op.put);
      else this.outbox.set(op.put.seq, op.put);
    }
  }
}

const DB_NAME = "orbyn-planner";
const DB_VERSION = 2;
const STORES = [
  ["tasks", "id"],
  ["lists", "id"],
  ["events", "id"],
  ["calendars", "id"],
  ["outbox", "seq"],
] as const;
const ALL = STORES.map(([name]) => name);

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** One IndexedDB object store per record type. */
export class IdbPersistence implements Persistence {
  private db: Promise<IDBDatabase> | null = null;

  private open(): Promise<IDBDatabase> {
    this.db ??= new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        // Version 1 had tasks, lists and the outbox; add whatever is missing.
        for (const [name, keyPath] of STORES) {
          if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name, { keyPath });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this.db;
  }

  async load(): Promise<Snapshot> {
    const db = await this.open();
    const tx = db.transaction(ALL, "readonly");
    const [tasks, lists, events, calendars, outbox] = await Promise.all([
      request(tx.objectStore("tasks").getAll() as IDBRequest<Task[]>),
      request(tx.objectStore("lists").getAll() as IDBRequest<TaskList[]>),
      request(tx.objectStore("events").getAll() as IDBRequest<CalendarEvent[]>),
      request(tx.objectStore("calendars").getAll() as IDBRequest<PlannerCalendar[]>),
      request(tx.objectStore("outbox").getAll() as IDBRequest<OutboxEntry[]>),
    ]);
    return { tasks, lists, events, calendars, outbox: outbox.sort((a, b) => a.seq - b.seq) };
  }

  async write(ops: PersistOp[]): Promise<void> {
    if (ops.length === 0) return;
    const db = await this.open();
    const tx = db.transaction(ALL, "readwrite");
    for (const op of ops) {
      const store = tx.objectStore(op.store);
      if ("delete" in op) store.delete(op.delete);
      else store.put(op.put);
    }
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }
}

export function defaultPersistence(): Persistence {
  return typeof indexedDB === "undefined" ? new MemoryPersistence() : new IdbPersistence();
}
