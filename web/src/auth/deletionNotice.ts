import { useSyncExternalStore } from "react";

/**
 * What this page knows about the account's scheduled deletion, shared by the banner, Settings and the sign-in screens: when it will
 * happen (RFC 3339), `null` when none is scheduled, `undefined` before the engine has said. The banner keeps it up to date from
 * `GET /v1/devices/current`; the dialog and the cancel buttons set it as soon as they know.
 */
let scheduledAt: string | null | undefined;
/** The person asked, on the sign-in screen, to cancel the deletion once they are signed in. */
let wantsCancel = false;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((l) => l());

export const deletionNotice = {
  get: () => scheduledAt,
  set(value: string | null | undefined) {
    if (value === scheduledAt) return;
    scheduledAt = value;
    emit();
  },
  intent: () => wantsCancel,
  setIntent(value: boolean) {
    wantsCancel = value;
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  },
};

/** When the account will be deleted, if a deletion is scheduled; re-renders when that changes. */
export function useDeletionScheduledAt(): string | null | undefined {
  return useSyncExternalStore(deletionNotice.subscribe, deletionNotice.get);
}

/** "November 14, 2026 at 12:00 PM" in the person's own locale and time zone. */
export function describeDeletionTime(rfc3339: string): string {
  const at = new Date(rfc3339);
  if (Number.isNaN(at.getTime())) return rfc3339;
  return at.toLocaleString(undefined, { dateStyle: "long", timeStyle: "short" });
}
