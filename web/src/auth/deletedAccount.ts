import type { AuthApi } from "../api/auth";

/**
 * An account the engine says was deleted (Account Designs: "The account was deleted"). A device asks once, after a 401: the status
 * route answers 200 with the UTC day when a tombstone exists and 404 for everything else. Only a 200 shows this; nothing is removed
 * from this browser until the person chooses.
 */
export type RemovalPhase = "choose" | "exported" | "export-failed" | "removing" | "remove-failed" | "final";

export interface DeletedAccount {
  accountId: string;
  email: string;
  /** The UTC day it was deleted, RFC 3339 at 00:00 UTC. */
  deletedAt: string;
  phase: RemovalPhase;
  /** False when the browser held the account in memory only: there is nothing to export or remove. */
  hadCopy: boolean;
  /** The last export: its name and size in bytes. */
  file: { name: string; size: number } | null;
}

let current: DeletedAccount | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const deletedAccount = {
  get: () => current,
  set(value: DeletedAccount | null) {
    current = value;
    emit();
  },
  update(patch: Partial<DeletedAccount>) {
    if (current) {
      current = { ...current, ...patch };
      emit();
    }
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  },
};

const asking = new Set<string>();

/**
 * Asked once after a 401 that ended a session. Anything but a 200 (404, 429, an unreachable engine) shows nothing: it is an ordinary
 * signed-out state, and the next 401 asks again.
 */
export async function askWhetherDeleted(api: Pick<AuthApi, "accountStatus">, session: { accountId: string; email: string }, inMemory: boolean): Promise<void> {
  if (asking.has(session.accountId)) return;
  asking.add(session.accountId);
  try {
    const status = await api.accountStatus(session.accountId);
    if (!status) return;
    deletedAccount.set({
      accountId: session.accountId,
      email: session.email,
      deletedAt: status.deleted_at,
      // A browser that held the account in memory only has no copy: it goes straight to the last screen.
      phase: inMemory ? "final" : "choose",
      hadCopy: !inMemory,
      file: null,
    });
  } catch {
    // Not reachable, or refused: not shown.
  } finally {
    asking.delete(session.accountId);
  }
}
