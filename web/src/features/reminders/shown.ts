/**
 * Which reminders have been shown, kept where the next tab to take over can read it. One tab shows
 * reminders at a time; when it closes another takes over, and without this it would show again
 * whatever came due in the last 15 minutes. Each shown key goes to IndexedDB and to the other tabs
 * over a BroadcastChannel. Everything here fails soft: without storage a hand-over may repeat one.
 */
import { isMemoryOnly } from "../../lib/browserStorage";

/** What this tab showed while the keys are held in memory only. */
const heldShown = new Set<string>();

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
  if (isMemoryOnly()) return Promise.resolve(new Set(heldShown));
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

/**
 * One channel for the whole page, shared by posting and listening, instead of one per call. A channel
 * does not hear its own posts, so this tab never marks its own reminder shown a second time.
 */
let shared: BroadcastChannel | null = null;
const listeners = new Set<(key: string) => void>();

function channel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === "undefined") return null;
  if (!shared) {
    shared = new BroadcastChannel(CHANNEL);
    shared.onmessage = (e: MessageEvent) => {
      if (typeof e.data === "string") for (const l of listeners) l(e.data);
    };
  }
  return shared;
}

/** Closes the shared channel (tests, or when no one is listening any more). */
function releaseChannel(): void {
  if (listeners.size === 0) {
    shared?.close();
    shared = null;
  }
}

/**
 * Records a shown key for the next leader and tells the other tabs. The promise settles when the
 * stored copy is written, and rejects if it could not be, so the caller can say that a hand-over may
 * repeat this reminder. Telling the other tabs never fails the call.
 */
export function rememberShown(key: string, now: number = Date.now()): Promise<void> {
  // While an account's keys are held in memory only, nothing is written to storage: what was shown is kept for this tab alone.
  if (isMemoryOnly()) {
    heldShown.add(key);
    return Promise.resolve();
  }
  try {
    channel()?.postMessage(key);
  } catch {
    // The stored copy still helps a later hand-over.
  }
  if (typeof indexedDB === "undefined") return Promise.resolve();
  return open().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(now, key);
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = tx.onabort = () => {
          db.close();
          reject(tx.error ?? new Error("could not save"));
        };
      }),
  );
}

/** Calls `onKey` for each key another tab shows. Returns a function that stops listening. */
export function listenShown(onKey: (key: string) => void): () => void {
  if (!channel()) return () => undefined;
  listeners.add(onKey);
  return () => {
    listeners.delete(onKey);
    releaseChannel();
  };
}
