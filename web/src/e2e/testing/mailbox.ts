import type { StoredSession } from "../../api/keyStore";
import { signUp } from "../../auth/flows";
import type { AuthServices } from "../../auth/services";

/** Where the test mailbox's API is (Mailpit, which the engine's worker sends to); set with ORBYN_E2E_MAIL, such as http://127.0.0.1:8025. */
export const mailUrl = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.ORBYN_E2E_MAIL;

/** The newest six-digit code mailed to `address`, waiting for it to arrive. Only the codes it hasn't seen (`not`) count, so a resend's code is the new one. */
export async function codeSentTo(address: string, not: string[] = [], ms = 30_000): Promise<string> {
  if (!mailUrl) throw new Error("set ORBYN_E2E_MAIL to the test mailbox's API");
  const end = Date.now() + ms;
  for (;;) {
    const found = await fetch(`${mailUrl}/api/v1/search?query=${encodeURIComponent(`to:${address}`)}`)
      .then((r) => r.json() as Promise<{ messages?: { ID: string }[] }>)
      .catch(() => ({ messages: [] as { ID: string }[] }));
    for (const m of found.messages ?? []) {
      const full = (await fetch(`${mailUrl}/api/v1/message/${m.ID}`).then((r) => r.json())) as { Text?: string };
      const code = /\b(\d{6})\b/.exec(full.Text ?? "")?.[1];
      if (code && !not.includes(code)) return code;
    }
    if (Date.now() > end) throw new Error(`no code arrived for ${address}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

/** Signs up and verifies with the code from the test mailbox: the whole sign-up. */
export async function signUpVerified(services: AuthServices, input: { name: string; email: string; password: string }): Promise<StoredSession> {
  const pending = await signUp(services, input);
  return pending.verify(await codeSentTo(input.email));
}
