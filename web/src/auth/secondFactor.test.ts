import { describe, expect, it } from "vitest";
import { ApiFailure } from "../api/auth";
import { createMemoryKeyStore } from "../api/keyStore";
import { FakeAuthCrypto } from "../api/testing/FakeAuthCrypto";
import { createMockEngine, MOCK_TOTP_CODE, type MockEngine } from "../api/testing/MockEngine";
import { confirmTotp, disableTotp, enrolTotp, SecondFactorNeeded, signIn, signUp } from "./flows";
import { createAuthServices, type AuthServices } from "./services";

const crypto = new FakeAuthCrypto();
const SAM = { name: "Sam", email: "sam@example.com", password: "correct horse battery" };

const browser = (engine: MockEngine): AuthServices =>
  createAuthServices({ fetch: engine.fetch, baseUrl: "http://e.test", keys: createMemoryKeyStore(), crypto: () => crypto, wrapSecret: async () => new Uint8Array(32).fill(4) });

/** An account with two-factor on, made from its first (trusted) browser; and a second browser that has not signed in yet. */
async function accountWithTotp() {
  const engine = createMockEngine();
  const first = browser(engine);
  const session = await signUp(first, SAM);
  await enrolTotp(first, session);
  const { recovery_codes } = await confirmTotp(first, session, MOCK_TOTP_CODE);
  return { engine, first, session, recovery_codes, second: browser(engine) };
}

/** The sign-in of a new browser stops at the code step. */
async function needsCode(services: AuthServices) {
  const error = await signIn(services, SAM).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(SecondFactorNeeded);
  return error as SecondFactorNeeded;
}

describe("signing in to an account with two-factor on", () => {
  it("stops at a code step with no session, and a wrong code leaves it open for another try", async () => {
    const { second } = await accountWithTotp();
    const step = await needsCode(second);
    expect(second.tokens.getSession()).toBeNull();
    const wrong = await step.complete({ code: "000000" }).catch((e: unknown) => e);
    expect(wrong).toBeInstanceOf(ApiFailure);
    expect((wrong as ApiFailure).code).toBe("second_factor_failed");
    expect((wrong as ApiFailure).message).toBe("That code didn’t work.");
    const session = await step.complete({ code: MOCK_TOTP_CODE });
    expect(second.tokens.getSession()?.token).toBe(session.token);
    expect(session.deviceState).toBe("pending"); // a new device still has to be approved
  });

  it("a recovery code signs in once, and the same one doesn't work again", async () => {
    const { engine, second, recovery_codes } = await accountWithTotp();
    const step = await needsCode(second);
    await step.complete({ recoveryCode: recovery_codes[0]! });
    const again = await needsCode(browser(engine));
    const reuse = await again.complete({ recoveryCode: recovery_codes[0]! }).catch((e: unknown) => e);
    expect((reuse as ApiFailure).code).toBe("second_factor_failed");
  });

  it("five wrong codes close the sign-in; the password step has to start again", async () => {
    const { second } = await accountWithTotp();
    const step = await needsCode(second);
    for (let i = 0; i < 5; i++) await step.complete({ code: "000000" }).catch(() => undefined);
    const closed = await step.complete({ code: MOCK_TOTP_CODE }).catch((e: unknown) => e);
    expect((closed as ApiFailure).code).toBe("login_failed");
    expect(second.tokens.getSession()).toBeNull();
  });

  it("a browser that already holds trusted keys is not asked", async () => {
    const { first } = await accountWithTotp();
    await first.tokens.clear();
    const session = await signIn(first, SAM);
    expect(session.deviceState).toBe("trusted");
  });
});

describe("changing two-factor needs this device's signature, and turning it off needs no code", () => {
  it("a bare token is refused with device_proof_required, and the signed calls work", async () => {
    const engine = createMockEngine();
    const services = browser(engine);
    const session = await signUp(services, SAM);
    const bare = await services.api.totpEnrol({ device_signature: null, signed_at: null }).catch((e: unknown) => e);
    expect((bare as ApiFailure).code).toBe("device_proof_required");

    await enrolTotp(services, session);
    expect((await services.api.currentDevice()).totp_pending).toBe(true);
    const wrongCode = await confirmTotp(services, session, "111111").catch((e: unknown) => e);
    expect((wrongCode as ApiFailure).code).toBe("second_factor_failed");
    await confirmTotp(services, session, MOCK_TOTP_CODE);
    expect(await services.api.currentDevice()).toMatchObject({ totp_enabled: true, totp_pending: false });
    await disableTotp(services, session);
    expect(await services.api.currentDevice()).toMatchObject({ totp_enabled: false, totp_pending: false });
  });

  it("each signature is strictly later than the last for that action: retries in the same second sign one second on, and one refusal is answered by signing again", async () => {
    const engine = createMockEngine();
    const services = browser(engine);
    const session = await signUp(services, SAM);
    await enrolTotp(services, session);
    await enrolTotp(services, session); // the same second, the same action: still accepted
    const signedAt = () => engine.calls.filter((c) => c.path === "/v1/accounts/totp").map((c) => Number((c.body as { signed_at: number }).signed_at));
    const [first, second] = signedAt();
    expect(second).toBeGreaterThan(first!);

    engine.refuseNext("/v1/accounts/totp", 401, "device_proof_required"); // the engine had already used that time, say
    await enrolTotp(services, session); // signed again once, not a failure
    const times = signedAt();
    expect(times).toHaveLength(4);
    expect(times[3]!).toBeGreaterThan(times[2]!);

    // But only once: a second refusal in a row is the answer.
    engine.refuseNext("/v1/accounts/totp", 401, "device_proof_required");
    engine.refuseNext("/v1/accounts/totp", 401, "device_proof_required");
    const failed = await enrolTotp(services, session).catch((e: unknown) => e);
    expect((failed as ApiFailure).code).toBe("device_proof_required");
  });
});
