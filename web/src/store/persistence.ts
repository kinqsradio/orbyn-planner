import type { OutboxEntry, Task, TaskList } from "./types";

export interface Snapshot {
  tasks: Task[];
  lists: TaskList[];
  outbox: OutboxEntry[];
}

export type PersistOp =
  | { store: "tasks"; put: Task }
  | { store: "tasks"; delete: string }
  | { store: "lists"; put: TaskList }
  | { store: "outbox"; put: OutboxEntry };

export interface Persistence {
  load(): Promise<Snapshot>;
  write(ops: PersistOp[]): Promise<void>;
}

/** Keeps everything in memory. Used when IndexedDB is unavailable, and in tests. */
export class MemoryPersistence implements Persistence {
  private tasks = new Map<string, Task>();
  private lists = new Map<string, TaskList>();
  private outbox = new Map<number, OutboxEntry>();

  async load(): Promise<Snapshot> {
    return {
      tasks: [...this.tasks.values()],
      lists: [...this.lists.values()],
      outbox: [...this.outbox.values()].sort((a, b) => a.seq - b.seq),
    };
  }

  async write(ops: PersistOp[]): Promise<void> {
    for (const op of ops) {
      if (op.store === "tasks") {
        if ("delete" in op) this.tasks.delete(op.delete);
        else this.tasks.set(op.put.id, op.put);
      } else if (op.store === "lists") this.lists.set(op.put.id, op.put);
      else this.outbox.set(op.put.seq, op.put);
    }
  }
}

const DB_NAME = "orbyn-planner";
const STORES = [
  ["tasks", "id"],
  ["lists", "id"],
  ["outbox", "seq"],
] as const;

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
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        for (const [name, keyPath] of STORES) req.result.createObjectStore(name, { keyPath });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this.db;
  }

  async load(): Promise<Snapshot> {
    const db = await this.open();
    const tx = db.transaction(["tasks", "lists", "outbox"], "readonly");
    const [tasks, lists, outbox] = await Promise.all([
      request(tx.objectStore("tasks").getAll() as IDBRequest<Task[]>),
      request(tx.objectStore("lists").getAll() as IDBRequest<TaskList[]>),
      request(tx.objectStore("outbox").getAll() as IDBRequest<OutboxEntry[]>),
    ]);
    return { tasks, lists, outbox: outbox.sort((a, b) => a.seq - b.seq) };
  }

  async write(ops: PersistOp[]): Promise<void> {
    if (ops.length === 0) return;
    const db = await this.open();
    const tx = db.transaction(["tasks", "lists", "outbox"], "readwrite");
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
