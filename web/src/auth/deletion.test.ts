import { describe, expect, it } from "vitest";
import { ApiFailure } from "../api/auth";
import { createMemoryKeyStore } from "../api/keyStore";
import { FakeAuthCrypto } from "../api/testing/FakeAuthCrypto";
import { createMockEngine, type MockEngine } from "../api/testing/MockEngine";
import { cancelDeletion, cancelDeletionByMail, scheduleDeletion, signIn, signInAgain } from "./flows";
import { signedUp } from "./testing/signedUp";
import { createAuthServices, type AuthServices } from "./services";

const crypto = new FakeAuthCrypto();
const SAM = { name: "Sam", email: "sam@example.com", password: "correct horse battery" };
const DAY = 86_400_000;

/** The one clock of a test, shared by the engine and every browser, that the test can move. */
let time = Date.UTC(2026, 10, 7, 10, 0, 0);
const now = () => time;
const advance = (ms: number) => void (time += ms);

const browser = (engine: MockEngine): AuthServices =>
  createAuthServices({ fetch: engine.fetch, baseUrl: "http://e.test", keys: createMemoryKeyStore(), crypto: () => crypto, wrapSecret: async () => new Uint8Array(32).fill(4), now });

async function aSignedUpAccount() {
  const engine = createMockEngine(now);
  const services = browser(engine);
  const session = await signedUp(engine, services, SAM);
  return { engine, services, session };
}

describe("a scheduled account deletion", () => {
  it("is asked for from a recent sign-in, waits seven days, and a stale session must sign in again first", async () => {
    const { engine, services, session } = await aSignedUpAccount();
    advance(11 * 60_000); // the sign-up session is eleven minutes old
    const stale = await scheduleDeletion(services, session).catch((e: unknown) => e);
    expect(stale).toBeInstanceOf(ApiFailure);
    expect((stale as ApiFailure).code).toBe("reauthentication_required");
    expect(services.tokens.getSession()).not.toBeNull(); // about this request, not the session
    expect(engine.accounts.get(SAM.email)!.deletion).toBeUndefined();

    const fresh = await signInAgain(services, session, SAM.password);
    const at = await scheduleDeletion(services, fresh);
    expect(Date.parse(at) - now()).toBe(7 * DAY);
    expect(engine.mail).toHaveLength(1);
    // Asking again keeps the time and sends nothing more.
    expect(await scheduleDeletion(services, fresh)).toBe(at);
    expect(engine.mail).toHaveLength(1);
  });

  it("a wrong password at the sign-in step schedules nothing", async () => {
    const { engine, services, session } = await aSignedUpAccount();
    const failed = await signInAgain(services, session, "not the password").catch((e: unknown) => e);
    expect((failed as ApiFailure).code).toBe("login_failed");
    expect(engine.accounts.get(SAM.email)!.deletion).toBeUndefined();
  });

  it("is cancelled with this device's signature, and the engine shows no deletion afterwards", async () => {
    const { engine, services, session } = await aSignedUpAccount();
    const at = await scheduleDeletion(services, session);
    expect((await services.api.currentDevice()).deletion_scheduled_at).toBe(at);
    await cancelDeletion(services, session);
    expect((await services.api.currentDevice()).deletion_scheduled_at).toBeNull();
    expect(engine.accounts.get(SAM.email)!.deletion).toBeUndefined();
    // Nothing scheduled: cancelling again is not an error.
    await cancelDeletion(services, session);
  });

  it("is cancelled from a new device with a sign-in from the last ten minutes, and not with an older one", async () => {
    const { engine, services, session } = await aSignedUpAccount();
    await scheduleDeletion(services, session);
    const phone = browser(engine);
    const phoneSession = await signIn(phone, SAM); // pending, signed in just now
    expect(phoneSession.deviceState).toBe("pending");
    advance(11 * 60_000);
    const stale = await cancelDeletion(phone, phoneSession).catch((e: unknown) => e);
    expect((stale as ApiFailure).code).toBe("reauthentication_required");
    expect(phone.tokens.getSession()).not.toBeNull();
    expect(engine.accounts.get(SAM.email)!.deletion).toBeDefined();
    const again = await signIn(phone, SAM);
    await cancelDeletion(phone, again);
    expect(engine.accounts.get(SAM.email)!.deletion).toBeUndefined();
  });

  it("is cancelled by the email link's token with no session, once, and a wrong token is one answer", async () => {
    const { engine, services, session } = await aSignedUpAccount();
    await scheduleDeletion(services, session);
    const nobody = browser(engine); // no session at all
    const wrong = await cancelDeletionByMail(nobody, "not-the-token").catch((e: unknown) => e);
    expect((wrong as ApiFailure).code).toBe("invalid_cancel_token");
    expect(engine.accounts.get(SAM.email)!.deletion).toBeDefined(); // a wrong attempt burns nothing
    await cancelDeletionByMail(nobody, engine.mail[0]!.token);
    expect(engine.accounts.get(SAM.email)!.deletion).toBeUndefined();
    const used = await cancelDeletionByMail(nobody, engine.mail[0]!.token).catch((e: unknown) => e);
    expect((used as ApiFailure).code).toBe("invalid_cancel_token");
    // The link did nothing but cancel: the session still works.
    expect((await services.api.currentDevice()).device.id).toBe(session.deviceId);
  });
});
