/**
 * Whether two-factor is on for an account, as this browser last saw it. The engine has no call that says (it answers
 * `totp_already_enabled` or `totp_not_enabled` only when something is tried), so the page remembers what it did and corrects
 * itself from those two answers.
 */
const key = (accountId: string) => `orbyn-planner.two-factor:${accountId}`;

export function readTwoFactor(accountId: string): boolean {
  try {
    return localStorage.getItem(key(accountId)) === "on";
  } catch {
    return false;
  }
}

export function rememberTwoFactor(accountId: string, on: boolean): void {
  try {
    if (on) localStorage.setItem(key(accountId), "on");
    else localStorage.removeItem(key(accountId));
  } catch {
    // Storage unavailable: the row says off, and the engine's answers correct it.
  }
}
