import { describe, expect, it } from "vitest";
import { createMemoryKeyStore } from "../api/keyStore";
import { FakeAuthCrypto } from "../api/testing/FakeAuthCrypto";
import { createMockEngine } from "../api/testing/MockEngine";
import { KeysForAnotherAccount, signIn, signUp } from "./flows";
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

  /** Another account exists on the server, made from another browser. */
  async function otherAccount(engine: ReturnType<typeof createMockEngine>) {
    await signUp(createAuthServices({ fetch: engine.fetch, baseUrl: "http://e.test", keys: createMemoryKeyStore(), crypto: () => crypto, wrapSecret: async () => new Uint8Array(32).fill(8) }), {
      name: "Alex", email: "alex@example.com", password: "another long password",
    });
  }
  const OTHER = { email: "alex@example.com", password: "another long password" };
  const wrap = new Uint8Array(32).fill(4);

  it("another email asks first, naming the other account with most of it hidden, and sends nothing", async () => {
    const { engine, keys, services } = await signedUpAndOut();
    await otherAccount(engine);
    const calls = engine.calls.length;
    const error = await signIn(services, OTHER).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(KeysForAnotherAccount);
    expect((error as KeysForAnotherAccount).message).toBe(
      "This browser holds the keys for another Orbyn account (s•••@example.com). Signing in to a different account removes them from this browser.",
    );
    expect(engine.calls.length).toBe(calls); // not even a login start
    expect(await keys.loadKeys()).not.toBeNull();
  });

  it("after agreeing, a successful sign-in replaces the keys, sends no proof, and never registers the old key", async () => {
    const { engine, keys, services, first } = await signedUpAndOut();
    await otherAccount(engine);
    const signingKey = async () => crypto.deviceKeys.import((await keys.loadKeys())!, wrap).signingKey();
    const before = await signingKey();
    await keys.saveSnapshot(new Uint8Array([1, 2, 3]));
    await keys.quarantineSnapshot(new Uint8Array([5]));

    const next = await signIn(services, { ...OTHER, replaceKeys: true });

    expect(await signingKey()).not.toBe(before);
    const start = engine.calls.filter((c) => c.path === "/v1/sessions/login/start").at(-1)!.body as { trusted_device?: unknown };
    expect(start.trusted_device).toBeUndefined();
    expect(engine.state.trustedProofs).toBe(0);
    const finish = engine.calls.filter((c) => c.path === "/v1/sessions/login/finish").at(-1)!.body as { device: { signing_key: string } };
    expect(finish.device.signing_key).not.toBe(before);
    expect(await keys.loadSnapshot()).toBeNull();
    expect(await keys.loadQuarantine()).toEqual([]);
    expect(await keys.loadIdentity()).toEqual({ accountId: next.accountId, deviceId: next.deviceId, email: "alex@example.com" });
    expect(next.accountId).not.toBe(first.accountId);
  });

  it("a failed attempt leaves the old device exactly as it was", async () => {
    const { engine, keys, services } = await signedUpAndOut();
    await otherAccount(engine);
    const wrapKey = await globalThis.crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    await keys.saveWrapKey(wrapKey);
    await keys.saveSnapshot(new Uint8Array([1, 2, 3]));
    await keys.quarantineSnapshot(new Uint8Array([5]));
    const sealedKeys = await keys.loadKeys();
    const identity = await keys.loadIdentity();
    const unchanged = async () => {
      expect(await keys.loadKeys()).toEqual(sealedKeys);
      expect(await keys.loadSnapshot()).toEqual(new Uint8Array([1, 2, 3]));
      expect(await keys.loadWrapKey()).toBe(wrapKey);
      expect(await keys.loadIdentity()).toEqual(identity);
      expect(await keys.loadQuarantine()).toEqual([new Uint8Array([5])]);
    };

    // A wrong password fails on the device after the login start.
    await expect(signIn(services, { ...OTHER, password: "wrong wrong wrong", replaceKeys: true })).rejects.toThrow();
    await unchanged();
    // The server refuses the start.
    engine.refuseNext("/v1/sessions/login/start", 429, "too_many_attempts");
    await expect(signIn(services, { ...OTHER, replaceKeys: true })).rejects.toThrow();
    await unchanged();
    // The server refuses the finish.
    engine.refuseNext("/v1/sessions/login/finish", 500, "internal");
    await expect(signIn(services, { ...OTHER, replaceKeys: true })).rejects.toThrow();
    await unchanged();
    // An email that doesn't exist at all.
    await expect(signIn(services, { email: "nobody@example.com", password: "whatever whatever", replaceKeys: true })).rejects.toThrow();
    await unchanged();
  });

  it("keys with no email recorded are treated as another account's, and asked about", async () => {
    const { keys, services, first } = await signedUpAndOut();
    await keys.saveIdentity({ accountId: first.accountId, deviceId: first.deviceId });
    const error = await signIn(services, SAM).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(KeysForAnotherAccount);
    expect((error as KeysForAnotherAccount).maskedEmail).toBeNull();
  });

  it("replacing the keys runs under the engine's lock: an action in progress finishes and saves first", async () => {
    const { engine, keys, services, first } = await signedUpAndOut();
    await otherAccount(engine);
    await keys.saveSnapshot(new Uint8Array([1, 2, 3]));
    const old = await keys.loadKeys();
    let release!: () => void;
    // An action in another tab, still running, saves its state when it ends.
    const action = services.engine.run(first, () => new Promise<void>((r) => (release = r)));
    const signingIn = signIn(services, { ...OTHER, replaceKeys: true });
    await new Promise((r) => setTimeout(r, 40));
    expect(await keys.loadKeys()).toEqual(old); // not replaced while the action runs
    release();
    await action;
    await signingIn;
    expect(await keys.loadKeys()).not.toEqual(old);
    // The action's save came first and was then wiped; had the wipe run first, it would have been written back.
    expect(await keys.loadSnapshot()).toBeNull();
  });
});
