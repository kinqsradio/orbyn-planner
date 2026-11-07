// @vitest-environment node
//
// Deleting the account against a running engine with the real module: asked for with a signature from a recent sign-in and the second
// factor, scheduled seven days out, shown to every device, and cancelled by a new device that has just signed in, by the original
// device, and by the link in the email with no session at all. The engine's worker does the deletion itself (its own tests cover
// that). Runs only when ORBYN_E2E_ENGINE and ORBYN_E2E_MAIL are set.
import { describe, expect, it } from "vitest";
import { ApiFailure } from "../api/auth";
import { cancelDeletion, cancelDeletionByMail, confirmTotp, enrolTotp, scheduleDeletion, SecondFactorNeeded, signIn, signInAgain } from "../auth/flows";
import { cancelTokenSentTo, signUpVerified } from "./testing/mailbox";
import { browser, engineUrl, totpCode } from "./testing/support";

const password = "correct horse battery staple";
const now = () => Math.floor(Date.now() / 1000);
const DAY = 86_400_000;

describe.skipIf(!engineUrl)("a scheduled account deletion against a real engine", () => {
  it("needs the second factor, waits seven days, shows on every device, and cancels from a new device, the original one and the email link", async () => {
    const email = `e2e-delete-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
    const a = await browser();
    const first = await signUpVerified(a.services, { name: "Sam", email, password });
    const enrolment = await enrolTotp(a.services, first);
    const { recovery_codes } = await confirmTotp(a.services, first, await totpCode(enrolment.secret, now()));
    const b = await browser();
    // A second device: asked for the code too, and signs in with a recovery code.
    const step = await signIn(b.services, { email, password }).catch((e: unknown) => e);
    expect(step).toBeInstanceOf(SecondFactorNeeded);
    const second = await (step as SecondFactorNeeded).complete({ recoveryCode: recovery_codes[0]! });

    // The password again (a sign-in from the last ten minutes), then a wrong code: nothing is scheduled.
    const session = await signInAgain(a.services, first, password);
    const refused = await scheduleDeletion(a.services, session, { code: "000000" }).catch((e: unknown) => e);
    expect((refused as ApiFailure).code).toBe("second_factor_failed");
    expect((await a.services.api.currentDevice()).deletion_scheduled_at ?? null).toBeNull();

    // A recovery code schedules it, seven days away, and one email goes out.
    const at = await scheduleDeletion(a.services, session, { recoveryCode: recovery_codes[1]! });
    expect(Date.parse(at) - Date.now()).toBeGreaterThan(6.99 * DAY);
    expect(Date.parse(at) - Date.now()).toBeLessThan(7.01 * DAY);
    const firstToken = await cancelTokenSentTo(email);

    // Every device sees it, the one waiting for approval too, and the account still works.
    expect((await a.services.api.currentDevice()).deletion_scheduled_at).toBe(at);
    expect((await b.services.api.currentDevice()).deletion_scheduled_at).toBe(at);

    // The new device cancels with its signature, from its recent sign-in. That ends the first email's link too.
    await cancelDeletion(b.services, second);
    expect((await a.services.api.currentDevice()).deletion_scheduled_at ?? null).toBeNull();
    const old = await cancelDeletionByMail((await browser()).services, firstToken).catch((e: unknown) => e);
    expect((old as ApiFailure).code).toBe("invalid_cancel_token");

    // Schedule again and cancel from the original, trusted device.
    await scheduleDeletion(a.services, session, { recoveryCode: recovery_codes[2]! });
    await cancelDeletion(a.services, session);
    expect((await b.services.api.currentDevice()).deletion_scheduled_at ?? null).toBeNull();

    // Schedule a third time: a new email with a new token. Asking again keeps the time and the link, which then cancels with no
    // session at all, once.
    const third = await scheduleDeletion(a.services, session, { recoveryCode: recovery_codes[3]! });
    const token = await cancelTokenSentTo(email, [firstToken]);
    expect(token).not.toBe(firstToken);
    expect(await scheduleDeletion(a.services, session, { recoveryCode: recovery_codes[4]! })).toBe(third);
    const nobody = await browser();
    const wrong = await cancelDeletionByMail(nobody.services, "A".repeat(43)).catch((e: unknown) => e);
    expect((wrong as ApiFailure).code).toBe("invalid_cancel_token");
    expect((await a.services.api.currentDevice()).deletion_scheduled_at).toBe(third); // a wrong token burned nothing
    await cancelDeletionByMail(nobody.services, token);
    expect((await a.services.api.currentDevice()).deletion_scheduled_at ?? null).toBeNull();
    const used = await cancelDeletionByMail(nobody.services, token).catch((e: unknown) => e);
    expect((used as ApiFailure).code).toBe("invalid_cancel_token");
    // The link did nothing but cancel: this device's session still works.
    expect((await a.services.api.currentDevice()).totp_enabled).toBe(true);
  }, 180_000);
});
