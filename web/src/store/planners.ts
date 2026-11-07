import { LocalStore } from "./LocalStore";
import { DEVICE_DB, MemoryPersistence } from "./persistence";

/**
 * Whose planner is open. The planner kept on this device alone is one IndexedDB database; each account has
 * a database of its own, named by its id, so an account's records and outbox can never be shown to, or
 * uploaded for, another account. Signing out opens the device-only planner again; the account's database
 * stays until the person removes it, and opens only when that same account signs in again.
 */
export const accountDb = (accountId: string) => `orbyn-planner-account-${accountId}`;

const open = new Map<string, LocalStore>();

/** The planner for an account (or, with null, for this device alone). One store per database in a page. */
export function plannerFor(accountId: string | null): LocalStore {
  const name = accountId === null ? DEVICE_DB : accountDb(accountId);
  let store = open.get(name);
  if (!store) {
    store = new LocalStore({ dbName: name });
    open.set(name, store);
  }
  return store;
}

const inMemory = new Map<string, LocalStore>();

/** The planner for an account whose keys are held in memory only: nothing of it is written to storage, so it goes with the tab. */
export function memoryPlannerFor(accountId: string): LocalStore {
  let store = inMemory.get(accountId);
  if (!store) {
    store = new LocalStore({ persistence: new MemoryPersistence({ volatile: true }), broadcast: false });
    inMemory.set(accountId, store);
  }
  return store;
}

/** Lets go of an account's planner (its database stays). */
export function closePlanner(accountId: string): void {
  inMemory.get(accountId)?.close();
  inMemory.delete(accountId);
  const name = accountDb(accountId);
  open.get(name)?.close();
  open.delete(name);
}

async function deleteDatabase(name: string): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    // Another tab still has it open: it closes on the version change and the delete goes through.
    request.onblocked = () => undefined;
  });
}

/**
 * Whether this browser still holds a database for the account. A browser that cannot list databases is taken to hold one, so the
 * answer errs toward offering the export rather than hiding a copy.
 */
export async function accountPlannerExists(accountId: string): Promise<boolean> {
  if (typeof indexedDB === "undefined" || typeof indexedDB.databases !== "function") return true;
  try {
    return (await indexedDB.databases()).some((d) => d.name === accountDb(accountId));
  } catch {
    return true;
  }
}

/** Closes an account's planner and deletes its database from this browser: its records and its outbox. */
export async function removeAccountPlanner(accountId: string): Promise<void> {
  closePlanner(accountId);
  await deleteDatabase(accountDb(accountId));
}

/** Lets go of the planner kept on this device alone (its database stays). */
export function closeDevicePlanner(): void {
  open.get(DEVICE_DB)?.close();
  open.delete(DEVICE_DB);
}

/** Empties the planner kept on this device alone: its database is deleted, and it starts again empty when next opened. */
export async function removeDevicePlanner(): Promise<void> {
  closeDevicePlanner();
  await deleteDatabase(DEVICE_DB);
}

/** Lets go of every open planner. For tests. */
export function closeAllPlanners(): void {
  for (const store of open.values()) store.close();
  open.clear();
}
