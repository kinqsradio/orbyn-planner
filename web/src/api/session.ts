/**
 * The signed-in session's bearer token, held in memory for engine requests that need an account.
 * Sign-in sets it and sign-out clears it; until accounts land in this build it stays null.
 */
let token: string | null = null;

export function sessionToken(): string | null {
  return token;
}

export function setSessionToken(next: string | null): void {
  token = next && next.trim() !== "" ? next : null;
}
