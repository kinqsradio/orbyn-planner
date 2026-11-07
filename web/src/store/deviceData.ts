import { INBOX_ID, PERSONAL_CALENDAR_ID } from "./LocalStore";
import type { PlannerState } from "./types";

/**
 * Whether the planner kept on this device alone holds anything the person made: any task, event or project,
 * or a list or calendar besides the Inbox and Personal that every planner starts with.
 */
export function hasPlannerData(state: Pick<PlannerState, "tasks" | "events" | "projects" | "lists" | "calendars" | "tags">): boolean {
  return (
    state.tasks.length > 0 ||
    state.events.length > 0 ||
    state.projects.length > 0 ||
    state.tags.length > 0 ||
    state.lists.some((l) => l.id !== INBOX_ID) ||
    state.calendars.some((c) => c.id !== PERSONAL_CALENDAR_ID)
  );
}

export type DeviceDataAnswer = "added" | "separate";

const key = (accountId: string) => `orbyn-planner-device-data:${accountId}`;
const memory = new Map<string, DeviceDataAnswer>();

/** What the person answered for this account on this browser, if they did. Asked once per account per browser. */
export function deviceDataAnswer(accountId: string): DeviceDataAnswer | null {
  try {
    const stored = localStorage.getItem(key(accountId));
    if (stored === "added" || stored === "separate") return stored;
  } catch {
    // Storage unavailable: the answer given in this page still holds.
  }
  return memory.get(accountId) ?? null;
}

/** Forgets what was answered for this account on this browser (its copy is being removed). */
export function forgetDeviceDataAnswer(accountId: string): void {
  memory.delete(accountId);
  try {
    localStorage.removeItem(key(accountId));
  } catch {
    // Storage unavailable: nothing was kept there.
  }
}

export function rememberDeviceDataAnswer(accountId: string, answer: DeviceDataAnswer): void {
  memory.set(accountId, answer);
  try {
    localStorage.setItem(key(accountId), answer);
  } catch {
    // Kept in memory for this page.
  }
}

/** Tests only. */
export function forgetDeviceDataAnswers(): void {
  memory.clear();
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith("orbyn-planner-device-data:")) localStorage.removeItem(k);
  } catch {
    // Nothing stored.
  }
}
