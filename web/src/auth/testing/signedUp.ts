import type { StoredSession } from "../../api/keyStore";
import type { MockEngine } from "../../api/testing/MockEngine";
import { signUp } from "../flows";
import type { AuthServices } from "../services";

/** Signs up and verifies with the code the mock engine "emailed": the whole sign-up, for tests that start from a signed-in account. Tests only. */
export async function signedUp(engine: MockEngine, services: AuthServices, input: { name: string; email: string; password: string }): Promise<StoredSession> {
  const pending = await signUp(services, input);
  const code = engine.emailCode(pending.signupId);
  if (!code) throw new Error("the mock engine has no code for this sign-up");
  return pending.verify(code);
}
