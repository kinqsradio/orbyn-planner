/**
 * Which reminders have been shown, kept where the next tab to take over can read it. One tab shows
 * reminders at a time; when it closes another takes over, and without this it would show again
 * whatever came due in the last 15 minutes. Each shown key goes to IndexedDB and to the other tabs
 * over a BroadcastChannel. Everything here fails soft: without storage a hand-over may repeat one.
 */
const DB = "orbyn-planner-reminders";
const STORE = "shown";
const CHANNEL = "orbyn-planner-reminders";
/** A key older than this can no longer be inside the grace period. */
export const KEEP_MS = 24 * 3_600_000;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** The keys shown in the last day. Old ones are removed as they are read. */
export function loadShown(now: number = Date.now()): Promise<Set<string>> {
  if (typeof indexedDB === "undefined") return Promise.resolve(new Set());
  return open()
    .then(
      (db) =>
        new Promise<Set<string>>((resolve) => {
          const out = new Set<string>();
          const tx = db.transaction(STORE, "readwrite");
          const store = tx.objectStore(STORE);
          const cursor = store.openCursor();
          cursor.onsuccess = () => {
            const c = cursor.result;
            if (!c) return;
            if (now - (c.value as number) > KEEP_MS) c.delete();
            else out.add(String(c.key));
            c.continue();
          };
          tx.oncomplete = () => {
            db.close();
            resolve(out);
          };
          tx.onerror = tx.onabort = () => {
            db.close();
            resolve(out);
          };
        }),
    )
    .catch(() => new Set<string>());
}

/** Records a shown key for the next leader and tells the other tabs. */
export function rememberShown(key: string, now: number = Date.now()): void {
  try {
    new BroadcastChannel(CHANNEL).postMessage(key);
  } catch {
    // No BroadcastChannel: the stored copy still helps a later hand-over.
  }
  if (typeof indexedDB === "undefined") return;
  open()
    .then((db) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(now, key);
      tx.oncomplete = tx.onerror = tx.onabort = () => db.close();
    })
    .catch(() => undefined);
}

/** Calls `onKey` for each key another tab shows. Returns a function that stops listening. */
export function listenShown(onKey: (key: string) => void): () => void {
  if (typeof BroadcastChannel === "undefined") return () => undefined;
  const channel = new BroadcastChannel(CHANNEL);
  channel.onmessage = (e: MessageEvent) => typeof e.data === "string" && onKey(e.data);
  return () => channel.close();
}
