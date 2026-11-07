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

/** Signing out removes what these kept: the account id in the key names and another device's name in a value. */
export function forgetProtectionNotice(accountId: string): void {
  try {
    for (const key of [seenKey(accountId), changedKey(accountId), confirmedKey(accountId), skippedKey(accountId)]) localStorage.removeItem(key);
  } catch {
    // Storage is unavailable, so nothing was kept.
  }
}
