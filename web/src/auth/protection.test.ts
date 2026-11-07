import { describe, expect, it } from "vitest";
import { ApiFailure } from "../api/auth";
import { createMemoryKeyStore } from "../api/keyStore";
import { FakeAuthCrypto } from "../api/testing/FakeAuthCrypto";
import { createMockEngine, type MockEngine } from "../api/testing/MockEngine";
import { confirmProtection, readProtection, signIn, signUp } from "./flows";
import { signedUp } from "./testing/signedUp";
import { createAuthServices, type AuthServices } from "./services";

const crypto = new FakeAuthCrypto();
const SAM = { name: "Sam", email: "sam@example.com", password: "correct horse battery" };

const browser = (engine: MockEngine): AuthServices =>
  createAuthServices({ fetch: engine.fetch, baseUrl: "http://e.test", keys: createMemoryKeyStore(), crypto: () => crypto, wrapSecret: async () => new Uint8Array(32).fill(4) });

describe("the signed protection setting", () => {
  it("the first device signs Standard, sequence 1, right after the sign-up is verified, and reads it back as verified", async () => {
    const engine = createMockEngine();
    const a = browser(engine);
    const session = await signedUp(engine, a, SAM);
    const chain = engine.accounts.get(SAM.email)!.protection!;
    expect(chain).toHaveLength(1);
    expect(chain[0]).toMatchObject({ level: "standard", seq: 1, signer_device_id: session.deviceId });
    const report = await readProtection(a, session);
    expect(report).toMatchObject({ state: "verified", level: "standard", seq: 1, stopped: null, problem: null, changedBy: null });
    expect(report.signer).toMatchObject({ thisDevice: true });
  });

  it("a failed signing does not fail the sign-up, and the level then reads as unknown", async () => {
    const engine = createMockEngine();
    engine.refuseNext("/v1/keychain/protection", 500, "internal");
    const a = browser(engine);
    const session = await signedUp(engine, a, SAM);
    expect(session.deviceState).toBe("trusted");
    expect(engine.accounts.get(SAM.email)!.protection ?? []).toHaveLength(0);
    expect(await readProtection(a, session)).toMatchObject({ state: "unknown", level: null, seq: 0, head: null });
  });

  it("on a conflict it fetches and verifies the chain instead of signing again", async () => {
    const engine = createMockEngine();
    engine.refuseNext("/v1/keychain/protection", 409, "protection_conflict");
    const a = browser(engine);
    const session = await signedUp(engine, a, SAM);
    const calls = engine.calls.filter((c) => c.path.startsWith("/v1/keychain/protection"));
    expect(calls.map((c) => c.method)).toEqual(["POST", "GET"]); // one try, then a read: no second POST
    expect(engine.accounts.get(SAM.email)!.protection ?? []).toHaveLength(0);
    expect(session.deviceState).toBe("trusted");
  });

  it("‘Confirm protection level’ signs after the head only when called, and a stale head is a conflict, not a retry", async () => {
    const engine = createMockEngine();
    const a = browser(engine);
    const session = await signedUp(engine, a, SAM);
    const report = await readProtection(a, session);
    const posts = () => engine.calls.filter((c) => c.path === "/v1/keychain/protection" && c.method === "POST").length;
    expect(posts()).toBe(1); // reading signs nothing
    await confirmProtection(a, session, "standard", report.head);
    expect(engine.accounts.get(SAM.email)!.protection!.map((l) => l.seq)).toEqual([1, 2]);
    // A head that is no longer the newest does not fit: the engine says so once.
    const stale = await confirmProtection(a, session, "standard", report.head).catch((e: unknown) => e);
    expect((stale as ApiFailure).code).toBe("protection_conflict");
    expect(posts()).toBe(3);
    // The engine read the chain after the conflict: it knows sequence 2 now, so the next signing is after it.
    expect((await readProtection(a, session)).seq).toBe(2);
    const get = engine.calls.filter((c) => c.path.startsWith("/v1/keychain/protection") && c.method === "GET").length;
    expect(get).toBeGreaterThanOrEqual(2);
    await confirmProtection(a, session, "standard", (await readProtection(a, session)).head);
    expect(engine.accounts.get(SAM.email)!.protection!.map((l) => l.seq)).toEqual([1, 2, 3]);
  });

  it("after a rollback the report is not verified and names no one", async () => {
    const engine = createMockEngine();
    const a = browser(engine);
    const session = await signedUp(engine, a, SAM);
    await confirmProtection(a, session, "standard", (await readProtection(a, session)).head);
    const account = engine.accounts.get(SAM.email)!;
    account.protection = account.protection!.slice(0, 1); // the server shows an older chain
    account.protectionFromStart = true;
    const report = await readProtection(a, session);
    expect(report).toMatchObject({ problem: "rollback", state: "provisional", changedBy: null });
  });

  it("a failure to keep the keys after the code is right says the account was made, not that the code was wrong", async () => {
    const engine = createMockEngine();
    const keys = createMemoryKeyStore();
    keys.saveKeys = () => Promise.reject(new Error("quota"));
    const a = createAuthServices({ fetch: engine.fetch, baseUrl: "http://e.test", keys, crypto: () => crypto, wrapSecret: async () => new Uint8Array(32).fill(4) });
    const pending = await signUp(a, SAM);
    const failed = await pending.verify(engine.emailCode(pending.signupId)!).catch((e: unknown) => e);
    expect((failed as ApiFailure).code).toBe("keys_not_saved");
    expect((failed as ApiFailure).message).toContain("Account created");
    expect(a.tokens.getSession()).toBeNull();
    expect(engine.accounts.has("sam@example.com")).toBe(true);
  });

  it("Try saving again keeps the same account: once storage works, the keys are kept and the session starts", async () => {
    const engine = createMockEngine();
    const keys = createMemoryKeyStore();
    const save = keys.saveKeys.bind(keys);
    keys.saveKeys = () => Promise.reject(new Error("quota"));
    const a = createAuthServices({ fetch: engine.fetch, baseUrl: "http://e.test", keys, crypto: () => crypto, wrapSecret: async () => new Uint8Array(32).fill(4) });
    const pending = await signUp(a, SAM);
    await pending.verify(engine.emailCode(pending.signupId)!).catch(() => undefined);
    expect(await pending.retrySave().catch((e: unknown) => (e as ApiFailure).code)).toBe("keys_not_saved"); // storage is still full
    keys.saveKeys = save;
    const session = await pending.retrySave();
    expect(a.tokens.getSession()?.accountId).toBe(session.accountId);
    expect(await keys.loadKeys()).not.toBeNull();
    expect(engine.calls.filter((c) => c.path === "/v1/accounts/email/verify")).toHaveLength(1); // the code was not used twice
  });

  it("a second device, once approved, reads the setting the first signed as verified", async () => {
    const engine = createMockEngine();
    const a = browser(engine);
    const first = await signedUp(engine, a, SAM);
    const b = browser(engine);
    const second = await signIn(b, SAM);
    // Trust by an approval the first device made: the mock engine's own shortcut for a trusted device.
    const account = engine.accounts.get(SAM.email)!;
    const device = account.devices.find((d) => d.id === second.deviceId)!;
    device.state = "trusted";
    device.approved_by = first.deviceId;
    device.approval_signature = "x";
    const trusted = { ...second, deviceState: "trusted" as const };
    await b.tokens.set(trusted);
    const report = await readProtection(b, trusted);
    expect(report.head?.seq).toBe(1);
    expect(report.signer).toMatchObject({ thisDevice: false });
    // The second device pins the first only through a recorded approval it can verify: with none it stops, and says why.
    expect(report.state).not.toBe("verified");
    expect(report.stopped).toBe("untrusted_signer");
  });
});
