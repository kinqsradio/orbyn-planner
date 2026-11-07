// @vitest-environment node
//
// Sign-up with email verification against a running engine whose worker sends to the test mailbox (ORBYN_E2E_MAIL; see
// .github/e2e-mail.compose.yaml): no account and no session until the code is right, a new code replaces the old one, and an
// address that already has an account gets the same answer and no mail. Runs only when ORBYN_E2E_ENGINE and ORBYN_E2E_MAIL are set.
import { describe, expect, it } from "vitest";
import { ApiFailure } from "../api/auth";
import { signIn, signUp } from "../auth/flows";
import { browser, engineUrl } from "./testing/support";
import { codeSentTo, mailUrl } from "./testing/mailbox";

const password = "correct horse battery staple";

describe.skipIf(!engineUrl || !mailUrl)("sign-up with a code from the mailbox", () => {
  it("makes no account until the code is right; a new code replaces the old; a taken address gets the same answer and no mail", async () => {
    const email = `e2e-verify-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
    const a = await browser();
    const pending = await signUp(a.services, { name: "Sam", email, password });
    expect(pending.signupId).toMatch(/^[0-9a-f-]{36}$/);
    expect(a.services.tokens.getSession()).toBeNull(); // no session
    expect(await a.keys.loadKeys()).toBeNull(); // nothing stored: the keys are in memory

    // No account yet: signing in with this email and password fails.
    const early = await browser();
    expect(((await signIn(early.services, { email, password }).catch((e: unknown) => e)) as ApiFailure).code).toBe("login_failed");

    const first = await codeSentTo(email);
    expect(first).toMatch(/^\d{6}$/);
    const wrong = await pending.verify(first === "000000" ? "111111" : "000000").catch((e: unknown) => e);
    expect((wrong as ApiFailure).code).toBe("invalid_email_code");
    expect((wrong as ApiFailure).message).toBe("That code didn’t work.");

    await pending.resend();
    const second = await codeSentTo(email, [first]);
    expect(second).not.toBe(first);
    expect(((await pending.verify(first).catch((e: unknown) => e)) as ApiFailure).code).toBe("invalid_email_code"); // the old code stopped working
    const session = await pending.verify(second);
    expect(session.deviceState).toBe("trusted");
    expect(await a.keys.loadKeys()).not.toBeNull(); // stored only now
    expect((await a.services.api.devices()).devices).toHaveLength(1);

    // The address now has an account: another sign-up gets the same kind of answer and never a code or an account.
    const b = await browser();
    const decoy = await signUp(b.services, { name: "Other", email, password: "another long password" });
    expect(decoy.signupId).toMatch(/^[0-9a-f-]{36}$/);
    const refused = await decoy.verify(second).catch((e: unknown) => e);
    expect((refused as ApiFailure).code).toBe("invalid_email_code");
    expect(b.services.tokens.getSession()).toBeNull();
    decoy.cancel();
  }, 120_000);
});
