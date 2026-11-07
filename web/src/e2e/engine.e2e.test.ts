// @vitest-environment node
//
// End to end against a running engine, with the real WebAssembly module and no fakes. It runs only when
// ORBYN_E2E_ENGINE names the engine (for example http://localhost:8080), which must have been started with
// ORBYN_AUTH_SETUP set; see docs/architecture.md, "Running the end-to-end test".
import { describe, expect, it } from "vitest";
import { realAuthCrypto } from "../api/testing/realModule";
import { createMemoryKeyStore, type KeyStore } from "../api/keyStore";
import { readProtection, removeDevice, signIn, signOut } from "../auth/flows";
import { signUpVerified } from "./testing/mailbox";
import { ApproverController, DeviceController } from "../auth/pairing";
import { createAuthServices, type AuthServices } from "../auth/services";

const engineUrl = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.ORBYN_E2E_ENGINE;

/** Waits for a condition, failing with `what` if it doesn't come. */
async function until(what: string, check: () => boolean, ms = 20_000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe.skipIf(!engineUrl)("a real engine, the real module", () => {
  const crypto = realAuthCrypto();
  const email = `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  const password = "correct horse battery staple";

  /** One browser: its own key store, wrapping secret and services. */
  function browser(): { services: AuthServices; keys: KeyStore } {
    const keys = createMemoryKeyStore();
    const wrap = globalThis.crypto.getRandomValues(new Uint8Array(32)); // in the app this comes from a non-extractable CryptoKey
    const services = createAuthServices({
      baseUrl: engineUrl,
      keys,
      crypto: () => crypto,
      wrapSecret: async () => wrap.slice(),
      poll: { firstMs: 30, maxMs: 150, totalMs: 20_000 },
    });
    return { services, keys };
  }

  it("signs up, signs in on a second device, pairs with the digits compared, and trusts both ways", async () => {
    const a = browser();
    const d = browser();

    // Device A signs up and is the first, trusted device.
    const first = await signUpVerified(a.services, { name: "Sam", email, password });
    expect(first.deviceState).toBe("trusted");

    // Device D signs in with the same password and is pending.
    const second = await signIn(d.services, { email, password });
    expect(second.deviceState).toBe("pending");
    expect(second.deviceId).not.toBe(first.deviceId);

    // A starts the approval for the pending device it finds in its list.
    const list = await a.services.api.devices();
    const pending = list.devices.find((x) => x.id === second.deviceId)!;
    expect(pending.state).toBe("pending");
    const approver = new ApproverController(a.services, first, pending);
    const device = new DeviceController(d.services, second);
    void approver.start();
    void device.run();

    // Both screens reach the digits, and they are the same six.
    await until("both devices to show the digits", () => approver.getState().phase === "compare" && device.getState().phase === "compare");
    const onA = approver.getState();
    const onD = device.getState();
    if (onA.phase !== "compare" || onD.phase !== "compare") throw new Error("not comparing");
    expect(onA.sas).toMatch(/^\d{6}$/);
    expect(onD.sas).toBe(onA.sas);
    expect(onA.fingerprint).toMatch(/\S/);

    // The person confirms on each. Nothing is trusted until both have.
    void approver.confirm();
    await until("the approver to wait for the new device", () => approver.getState().phase === "finishing");
    expect((await a.services.api.devices()).devices.find((x) => x.id === second.deviceId)!.state).toBe("pending");
    device.confirm();
    await until("both to finish", () => approver.getState().phase === "done" && device.getState().phase === "trusted");

    // Trusted on both sides: the server lists both as trusted, and each device's own engine state agrees.
    const after = await a.services.api.devices();
    expect(after.devices.map((x) => x.state).sort()).toEqual(["trusted", "trusted"]);
    const current = await d.services.api.currentDevice();
    expect(current.device.state).toBe("trusted");
    const seenByD = new Set(await d.services.engine.run(second, (e) => e.verifyDevices(after)));
    expect(seenByD.has(first.deviceId)).toBe(true); // D pinned A through the digits, not through the server's word
    expect(seenByD.has(second.deviceId)).toBe(true);
    const seenByA = new Set(await a.services.engine.run(first, (e) => e.verifyDevices(after)));
    expect(seenByA.has(second.deviceId)).toBe(true); // A linked D through its own approval

    // The engine's saved state was written, sealed, after each action.
    expect(await d.keys.loadSnapshot()).not.toBeNull();

    // The protection setting: sign-up signed Standard as sequence 1, the server holds exactly that, A reads it back as verified, and
    // D (approved by A, which vouched for it) reads the same, verified on D's own device.
    const chain = await a.services.api.protectionChain(1);
    expect(chain.links.map((l) => [l.seq, l.level, l.signer_device_id])).toEqual([[1, "standard", first.deviceId]]);
    expect(await readProtection(a.services, first)).toMatchObject({ state: "verified", level: "standard", seq: 1, stopped: null, problem: null });
    expect(await readProtection(d.services, { ...second, deviceState: "trusted" })).toMatchObject({ state: "verified", level: "standard", seq: 1, stopped: null, problem: null });

    // A removes D with a signed removal; the server lists the removal with its sequence.
    await removeDevice(a.services, first, pending);
    const removed = await a.services.api.devices();
    expect(removed.devices.map((x) => x.id)).not.toContain(second.deviceId);
    expect(removed.removals.map((r) => r.device_id)).toContain(second.deviceId);
    expect(removed.removals[0]!.sequence).toBeGreaterThanOrEqual(1);

    await signOut(a.services);
    expect(await a.keys.loadKeys()).toBeNull();
  }, 60_000);

  it("one attempt per approval: a cancel closes it for both, and a new approval starts clean", async () => {
    const mail = `e2e-cancel-${Date.now()}@example.com`;
    const a = browser();
    const d = browser();
    const first = await signUpVerified(a.services, { name: "Sam", email: mail, password });
    const second = await signIn(d.services, { email: mail, password });
    const pending = (await a.services.api.devices()).devices.find((x) => x.id === second.deviceId)!;
    const approver = new ApproverController(a.services, first, pending);
    const device = new DeviceController(d.services, second);
    void approver.start();
    void device.run();
    await until("the digits", () => approver.getState().phase === "compare" && device.getState().phase === "compare");
    await approver.cancel();
    await until("the new device to see it closed", () => device.getState().phase === "closed");
    expect((await d.services.api.currentDevice()).device.state).toBe("pending");
    // A new approval, started clean, goes through.
    const again = new ApproverController(a.services, first, pending);
    void again.start();
    device.startAgain();
    await until("the new digits", () => again.getState().phase === "compare" && device.getState().phase === "compare");
    again.dispose();
    device.dispose();
  }, 60_000);

  it("a wrong password is the same refusal as an unknown email", async () => {
    const b = browser();
    const wrong = await signIn(b.services, { email, password: "not the password at all" }).catch((e: unknown) => e as Error);
    const unknown = await signIn(b.services, { email: `nobody-${Date.now()}@example.com`, password }).catch((e: unknown) => e as Error);
    expect((wrong as Error).message).toBe((unknown as Error).message);
    expect(await b.keys.loadKeys()).toBeNull(); // nothing was stored for a failed attempt
  }, 30_000);
});
