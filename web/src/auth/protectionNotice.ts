/** The "protection was changed on another device" notice outlives the Privacy screen: what it remembers, per account, in this browser. */
export const seenKey = (accountId: string) => `orbyn-planner.protection-changed.${accountId}`;
export const changedKey = (accountId: string) => `orbyn-planner.protection-changed-by.${accountId}`;

/** Signing out removes what the notice kept: the account id in the key names and the other device's name in the value. */
export function forgetProtectionNotice(accountId: string): void {
  try {
    localStorage.removeItem(seenKey(accountId));
    localStorage.removeItem(changedKey(accountId));
  } catch {
    // Storage is unavailable, so nothing was kept.
  }
}
