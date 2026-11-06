import { LocalStore } from "./LocalStore";
import { DEVICE_DB } from "./persistence";

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

/** Lets go of an account's planner (its database stays). */
export function closePlanner(accountId: string): void {
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
