import { useSyncExternalStore } from "react";
import { MONTHS, WEEKDAYS } from "../lib/dates";

/**
 * What this page knows about the account's scheduled deletion, shared by the banner, Settings and the sign-in screens: when it will
 * happen (RFC 3339), `null` when none is scheduled, `undefined` before the engine has said. The banner keeps it up to date from
 * `GET /v1/devices/current`; the dialog and the cancel buttons set it as soon as they know.
 */
let scheduledAt: string | null | undefined;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((l) => l());

export const deletionNotice = {
  get: () => scheduledAt,
  set(value: string | null | undefined) {
    if (value === scheduledAt) return;
    scheduledAt = value;
    emit();
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

/** "Saturday 14 November": the day, as the designs word it. */
export function deletionDay(rfc3339: string): string {
  const at = new Date(rfc3339);
  if (Number.isNaN(at.getTime())) return rfc3339;
  return `${WEEKDAYS[at.getDay()]} ${at.getDate()} ${MONTHS[at.getMonth()]}`;
}

/**
 * The banner's countdown, as the designs word it, by the UTC calendar: on the day of the deletion "today at 09:00 UTC, in 5 hours" (in
 * the last hour "in under an hour"), on the day before "tomorrow at 12:00 UTC, in 23 hours", and two or more days out "on Saturday 14
 * November, in 2 days".
 */
export function deletionCountdown(rfc3339: string, now: Date): string {
  const at = new Date(rfc3339);
  const utcDay = (d: Date) => Math.floor(d.getTime() / 86_400_000);
  const days = utcDay(at) - utcDay(now);
  if (days <= 1) {
    const hours = Math.floor((at.getTime() - now.getTime()) / 3_600_000);
    const time = `${String(at.getUTCHours()).padStart(2, "0")}:${String(at.getUTCMinutes()).padStart(2, "0")} UTC`;
    return `${days <= 0 ? "today" : "tomorrow"} at ${time}, ${hours < 1 ? "in under an hour" : `in ${hours} ${hours === 1 ? "hour" : "hours"}`}`;
  }
  return `on ${deletionDay(rfc3339)}, in ${days} ${days === 1 ? "day" : "days"}`;
}

/** The person chose "Sign in again" in the delete dialog; once they have signed in, the dialog comes back. */
let reopenAfterSignIn = false;
let reopened = 0;
export const deleteIntent = {
  want: () => void (reopenAfterSignIn = true),
  /** Called when a sign-in worked: if the person came from the delete dialog, whoever shows it is told to open it again. */
  signedIn: () => {
    if (!reopenAfterSignIn) return;
    reopenAfterSignIn = false;
    reopened += 1;
    emit();
  },
  /** How many times the dialog was asked to come back. */
  count: () => reopened,
  subscribe: (listener: () => void) => deletionNotice.subscribe(listener),
};

/** What a paused control says on hover or focus while an account is scheduled for deletion. */
export const PAUSED_HINT = "Cancel deletion to change this";

/** The same, on the protection controls. */
export const PAUSED_PROTECTION_HINT = "Cancel deletion to change protection";

/** True while a deletion is scheduled: adding or removing devices, changing protection or two-factor, and signing out everywhere are paused. */
export function useDeletionPaused(): boolean {
  return Boolean(useDeletionScheduledAt());
}
