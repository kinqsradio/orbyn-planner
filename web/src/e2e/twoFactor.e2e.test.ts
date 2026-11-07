// @vitest-environment node
//
// Two-factor against a running engine with the real module: turn it on with this device's signature, sign in on other browsers
// with a code and a recovery code, see a replayed code refused, and turn it off with no code. Runs only when ORBYN_E2E_ENGINE is set.
import { describe, expect, it } from "vitest";
import { ApiFailure } from "../api/auth";
import { confirmTotp, disableTotp, enrolTotp, SecondFactorNeeded, signIn, signUp } from "../auth/flows";
import { browser, engineUrl, totpCode } from "./testing/support";

const password = "correct horse battery staple";
const now = () => Math.floor(Date.now() / 1000);

describe.skipIf(!engineUrl)("two-factor against a real engine", () => {
  it("is turned on by a signed request, asked for at sign-in (code, replay, recovery code), and turned off with no code", async () => {
    const email = `e2e-2fa-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
    const a = await browser();
    const session = await signUp(a.services, { name: "Sam", email, password });
    expect(await a.services.api.currentDevice()).toMatchObject({ totp_enabled: false, totp_pending: false });

    // A bare token is not enough.
    const bare = await a.services.api.totpEnrol({ device_signature: null, signed_at: null }).catch((e: unknown) => e);
    expect((bare as ApiFailure).code).toBe("device_proof_required");

    const enrolment = await enrolTotp(a.services, session);
    expect(enrolment.uri).toMatch(/^otpauth:\/\/totp\/Orbyn:/);
    expect((await a.services.api.currentDevice()).totp_pending).toBe(true);
    const wrong = await confirmTotp(a.services, session, "000000").catch((e: unknown) => e);
    expect((wrong as ApiFailure).code).toBe("second_factor_failed");
    const { recovery_codes } = await confirmTotp(a.services, session, await totpCode(enrolment.secret, now()));
    expect(recovery_codes).toHaveLength(10);
    expect(await a.services.api.currentDevice()).toMatchObject({ totp_enabled: true, totp_pending: false });

    // A new browser is asked for a code. A wrong one is refused; the next step's code works (one step of drift is allowed, and it is newer than the one that confirmed).
    const b = await browser();
    const step = await signIn(b.services, { email, password }).catch((e: unknown) => e);
    expect(step).toBeInstanceOf(SecondFactorNeeded);
    const refused = await (step as SecondFactorNeeded).complete({ code: "000000" }).catch((e: unknown) => e);
    expect((refused as ApiFailure).code).toBe("second_factor_failed");
    const code = await totpCode(enrolment.secret, now() + 30);
    const signedIn = await (step as SecondFactorNeeded).complete({ code });
    expect(signedIn.deviceState).toBe("pending");

    // The same code can't be used twice, by anyone.
    const c = await browser();
    const second = await signIn(c.services, { email, password }).catch((e: unknown) => e);
    const replay = await (second as SecondFactorNeeded).complete({ code }).catch((e: unknown) => e);
    expect((replay as ApiFailure).code).toBe("second_factor_failed");
    // A recovery code works once.
    await (second as SecondFactorNeeded).complete({ recoveryCode: recovery_codes[0]! });
    const d = await browser();
    const third = await signIn(d.services, { email, password }).catch((e: unknown) => e);
    const used = await (third as SecondFactorNeeded).complete({ recoveryCode: recovery_codes[0]! }).catch((e: unknown) => e);
    expect((used as ApiFailure).code).toBe("second_factor_failed");
    (third as SecondFactorNeeded).cancel();

    // Off, with this device's signature and no code: the next new browser is not asked.
    await disableTotp(a.services, session);
    expect(await a.services.api.currentDevice()).toMatchObject({ totp_enabled: false, totp_pending: false });
    const e = await browser();
    expect((await signIn(e.services, { email, password })).deviceState).toBe("pending");
  }, 120_000);
});
