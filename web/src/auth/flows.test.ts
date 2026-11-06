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
    expect(await keys.loadIdentity()).toEqual({ accountId: first.accountId, deviceId: first.deviceId });
  });

  it("a different device id means the old row was removed: the saved trust state is wiped, the keys stay", async () => {
    const { keys, services, first } = await signedUpAndOut();
    await keys.saveIdentity({ accountId: first.accountId, deviceId: "00000000-0000-4000-8000-0000000000ee" });
    const next = await signIn(services, SAM);
    expect(await keys.loadSnapshot()).toBeNull();
    expect(await keys.loadKeys()).not.toBeNull();
    expect(await keys.loadIdentity()).toEqual({ accountId: next.accountId, deviceId: next.deviceId });
  });

  it("keys made for another account are replaced and the old state wiped", async () => {
    const { keys, services, first } = await signedUpAndOut();
    await keys.saveIdentity({ accountId: "00000000-0000-4000-8000-0000000000ff", deviceId: first.deviceId });
    const next = await signIn(services, SAM);
    expect(await keys.loadSnapshot()).toBeNull();
    expect(await keys.loadKeys()).not.toBeNull();
    expect(await keys.loadIdentity()).toEqual({ accountId: next.accountId, deviceId: next.deviceId });
  });

  it("a browser with no keys starts clean, whatever snapshot was left", async () => {
    const { keys, services } = await signedUpAndOut();
    await keys.clearKeys();
    await signIn(services, SAM);
    expect(await keys.loadSnapshot()).toBeNull();
    expect(await keys.loadKeys()).not.toBeNull();
  });
});
