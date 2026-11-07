import type { ProtectionReport } from "./flows";

/** What the Privacy screen remembers, per account, in this browser: the "changed on another device" notice, the last setting this device confirmed, and a "Not now". */
export const seenKey = (accountId: string) => `orbyn-planner.protection-changed.${accountId}`;
export const changedKey = (accountId: string) => `orbyn-planner.protection-changed-by.${accountId}`;
const confirmedKey = (accountId: string) => `orbyn-planner.protection-confirmed.${accountId}`;
const skippedKey = (accountId: string) => `orbyn-planner.protection-skipped.${accountId}`;

/** The setting this device last verified, for "last confirmed 3 Nov" when it can no longer say what the server has. */
export interface ConfirmedSetting {
  seq: number;
  level: string;
  /** Unix seconds the device that signed it gave. */
  at: number;
}

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Not remembered across visits; the screen still works.
  }
}

export const readConfirmed = (accountId: string) => read<ConfirmedSetting>(confirmedKey(accountId));
export const writeConfirmed = (accountId: string, setting: ConfirmedSetting) => write(confirmedKey(accountId), setting);
/** The newest setting the person chose "Not now" for on this device: the confirm dialog does not return for it. */
export const readSkipped = (accountId: string) => read<number>(skippedKey(accountId)) ?? 0;
export const writeSkipped = (accountId: string, seq: number) => write(skippedKey(accountId), seq);

/** The "changed on another device" notice outlives the screen until it is dismissed: it is kept for the sequence it was about. */
export function readSeen(accountId: string): number {
  try {
    return Number(localStorage.getItem(seenKey(accountId)) ?? 0) || 0;
  } catch {
    return 0;
  }
}
export function writeSeen(accountId: string, seq: number) {
  try {
    localStorage.setItem(seenKey(accountId), String(seq));
  } catch {
    // Not remembered across visits; fine.
  }
}

/** Takes a read of the chain: remembers the setting this browser verified, and a change another device made. */
export function recordReport(accountId: string, next: ProtectionReport) {
  if (next.state === "verified" && next.head && next.seq === next.head.seq) writeConfirmed(accountId, { seq: next.head.seq, level: next.head.level, at: Number(next.head.signed_at) });
  if (next.changedBy && next.head) write(changedKey(accountId), { seq: next.head.seq, name: next.changedBy.name });
}

/** A change by another device that this browser verified and the person has not dismissed: only a setting this browser verified names a device. */
export function pendingChange(accountId: string, report: ProtectionReport | null, dismissed = 0): { seq: number; name: string | null; level: string; at: number } | null {
  const changed = read<{ seq: number; name: string | null }>(changedKey(accountId));
  if (!changed || !report?.head || report.state !== "verified" || report.seq !== changed.seq || changed.seq <= Math.max(readSeen(accountId), dismissed)) return null;
  return { seq: changed.seq, name: changed.name, level: report.head.level, at: Number(report.head.signed_at) };
}

/** Signing out removes what these kept: the account id in the key names and another device's name in a value. */
export function forgetProtectionNotice(accountId: string): void {
  try {
    for (const key of [seenKey(accountId), changedKey(accountId), confirmedKey(accountId), skippedKey(accountId)]) localStorage.removeItem(key);
  } catch {
    // Storage is unavailable, so nothing was kept.
  }
}
