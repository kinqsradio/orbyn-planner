import { describe, expect, it } from "vitest";
import { createMemoryKeyStore } from "../api/keyStore";
import { FakeAuthCrypto } from "../api/testing/FakeAuthCrypto";
import { createMockEngine } from "../api/testing/MockEngine";
import { signIn, signUp } from "./flows";
import { createAuthServices } from "./services";

const crypto = new FakeAuthCrypto();
const SAM = { name: "Sam", email: "sam@example.com", password: "correct horse battery" };

async function signedUpAndOut() {
  const engine = createMockEngine();
  const keys = createMemoryKeyStore();
  const wrap = new Uint8Array(32).fill(4);
  const services = createAuthServices({ fetch: engine.fetch, baseUrl: "http://e.test", keys, crypto: () => crypto, wrapSecret: async () => wrap.slice() });
  const first = await signUp(services, SAM);
  await keys.saveSnapshot(new Uint8Array([1, 2, 3])); // the engine's state, as an action would have left it
  await keys.clearSession();
  await services.tokens.clear();
  return { engine, keys, services, first };
}

describe("signing in binds the stored state to the account and device", () => {
  it("the same account and device keep the saved state", async () => {
    const { keys, services, first } = await signedUpAndOut();
    await signIn(services, SAM);
    expect(await keys.loadSnapshot()).toEqual(new Uint8Array([1, 2, 3]));
    expect(await keys.loadIdentity()).toEqual({ accountId: first.accountId, deviceId: first.deviceId, email: SAM.email });
  });

  it("a different device id means the old row was removed: the saved trust state is wiped, the keys stay", async () => {
    const { keys, services, first } = await signedUpAndOut();
    await keys.saveIdentity({ accountId: first.accountId, deviceId: "00000000-0000-4000-8000-0000000000ee", email: SAM.email });
    const next = await signIn(services, SAM);
    expect(await keys.loadSnapshot()).toBeNull();
    expect(await keys.loadKeys()).not.toBeNull();
    expect(await keys.loadIdentity()).toEqual({ accountId: next.accountId, deviceId: next.deviceId, email: SAM.email });
  });

  it("keys made for another account are replaced and the old state wiped", async () => {
    const { keys, services, first } = await signedUpAndOut();
    await keys.saveIdentity({ accountId: "00000000-0000-4000-8000-0000000000ff", deviceId: first.deviceId, email: SAM.email });
    const next = await signIn(services, SAM);
    expect(await keys.loadSnapshot()).toBeNull();
    expect(await keys.loadKeys()).not.toBeNull();
    expect(await keys.loadIdentity()).toEqual({ accountId: next.accountId, deviceId: next.deviceId, email: SAM.email });
  });

  it("a browser with no keys starts clean, whatever snapshot was left", async () => {
    const { keys, services } = await signedUpAndOut();
    await keys.clearKeys();
    await signIn(services, SAM);
    expect(await keys.loadSnapshot()).toBeNull();
    expect(await keys.loadKeys()).not.toBeNull();
  });

  it("another email gets new device keys, forgets the old ones, and sends no trusted-device proof", async () => {
    const { engine, keys, services, first } = await signedUpAndOut();
    // A second account exists on the server, made from another browser.
    await signUp(createAuthServices({ fetch: engine.fetch, baseUrl: "http://e.test", keys: createMemoryKeyStore(), crypto: () => crypto, wrapSecret: async () => new Uint8Array(32).fill(8) }), {
      name: "Alex", email: "alex@example.com", password: "another long password",
    });
    const wrap = new Uint8Array(32).fill(4);
    const signingKey = async () => crypto.deviceKeys.import((await keys.loadKeys())!, wrap).signingKey();
    const before = await signingKey();
    await keys.saveSnapshot(new Uint8Array([1, 2, 3]));

    const next = await signIn(services, { email: "alex@example.com", password: "another long password" });

    expect(await signingKey()).not.toBe(before); // new keys
    const start = engine.calls.filter((c) => c.path === "/v1/sessions/login/start").at(-1)!.body as { trusted_device?: unknown };
    expect(start.trusted_device).toBeUndefined(); // the old key signed nothing for this account
    expect(engine.state.trustedProofs).toBe(0);
    const finish = engine.calls.filter((c) => c.path === "/v1/sessions/login/finish").at(-1)!.body as { device: { signing_key: string } };
    expect(finish.device.signing_key).not.toBe(before); // and was never registered with it
    expect(await keys.loadSnapshot()).toBeNull();
    expect(await keys.loadIdentity()).toEqual({ accountId: next.accountId, deviceId: next.deviceId, email: "alex@example.com" });
    expect(next.accountId).not.toBe(first.accountId);
    expect(next.deviceState).toBe("pending"); // a new account's new device waits to be approved or is first
  });

  it("keys with no email recorded are treated as another account's", async () => {
    const { engine, keys, services, first } = await signedUpAndOut();
    await keys.saveIdentity({ accountId: first.accountId, deviceId: first.deviceId });
    await signIn(services, SAM);
    expect(engine.state.trustedProofs).toBe(0);
  });
});
