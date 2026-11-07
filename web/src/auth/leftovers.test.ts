import { IDBFactory } from "fake-indexeddb";
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { createIdbKeyStore, createMemoryKeyStore, emptySyncState } from "../api/keyStore";
import { FakeAuthCrypto, fakeFreed } from "../api/testing/FakeAuthCrypto";
import { createMockEngine } from "../api/testing/MockEngine";
import { signIn, signUp } from "./flows";
import { ApproverController, DeviceController } from "./pairing";
import { createAuthServices } from "./services";
import { calls, createRig, until } from "./testing/rig";
import { signedUp } from "./testing/signedUp";

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

describe("the module's memory when sign-in or sign-up fails", () => {
  function counting() {
    const fake = new FakeAuthCrypto();
    const freed = { login: 0, registration: 0 };
    const crypto = Object.assign(Object.create(fake) as FakeAuthCrypto, {
      startLogin: (...a: Parameters<FakeAuthCrypto["startLogin"]>) => ({ ...fake.startLogin(...a), free: () => void (freed.login += 1) }),
      startRegistration: (...a: Parameters<FakeAuthCrypto["startRegistration"]>) => ({ ...fake.startRegistration(...a), free: () => void (freed.registration += 1) }),
    });
    return { crypto, freed };
  }

  it("a wrong password still frees the pending sign-in", async () => {
    const { crypto, freed } = counting();
    const engine = createMockEngine();
    const services = createAuthServices({ fetch: engine.fetch, baseUrl: "http://e.test", keys: createMemoryKeyStore(), crypto: () => crypto, wrapSecret: async () => new Uint8Array(32).fill(1) });
    await signedUp(engine, services, { name: "S", email: "s@example.com", password: "correct horse battery" });
    expect(freed.registration).toBe(1);
    await services.tokens.clear();
    await expect(signIn(services, { email: "s@example.com", password: "wrong wrong wrong" })).rejects.toThrow();
    expect(freed.login).toBe(1);
  });

  it("a failed sign-up still frees the pending registration", async () => {
    const { crypto, freed } = counting();
    crypto.finishRegistration = () => {
      throw new Error("auth_failed: bad answer");
    };
    const engine = createMockEngine();
    const services = createAuthServices({ fetch: engine.fetch, baseUrl: "http://e.test", keys: createMemoryKeyStore(), crypto: () => crypto, wrapSecret: async () => new Uint8Array(32).fill(1) });
    await expect(signUp(services, { name: "S", email: "s@example.com", password: "correct horse battery" })).rejects.toThrow();
    expect(freed.registration).toBe(1);
  });
});

describe("a join that finishes after the screen has gone", () => {
  it("is freed and never assigned, and sends no nonce", async () => {
    const r = await createRig();
    const approver = new ApproverController(r.a.services, r.a.session, r.d.device);
    void approver.start();
    await until(() => approver.getState().phase === "waiting");
    // Another action holds the engine's lock, so the join has to wait for it.
    let release!: () => void;
    const holding = r.d.services.engine.run(r.d.session, () => new Promise<void>((res) => (release = res)));
    const device = new DeviceController(r.d.services, r.d.session);
    void device.run();
    await new Promise((res) => setTimeout(res, 100)); // it has seen the approval and queued its join
    const before = fakeFreed.pairing;
    device.dispose();
    release();
    await holding;
    await new Promise((res) => setTimeout(res, 100));
    expect(fakeFreed.pairing).toBe(before + 1); // the join's session was given back
    expect(calls(r, "/nonce")).toHaveLength(0); // and nothing was answered
    approver.dispose();
  });
});

// The approving device may close the approval itself; only this device's cancels are counted.
const byDevice = (r: Parameters<typeof calls>[0]) => calls(r, "/cancel").filter((c) => c.authorization === "Bearer tok-d");

describe("a join whose screen goes while the nonce is in flight", () => {
  it("is freed and the approval is cancelled, so it doesn't stay open until it expires", async () => {
    const r = await createRig();
    const approver = new ApproverController(r.a.services, r.a.session, r.d.device);
    void approver.start();
    await until(() => approver.getState().phase === "waiting");
    r.delay.nonce = 300; // the nonce takes a while to get there
    const device = new DeviceController(r.d.services, r.d.session);
    void device.run();
    await new Promise((res) => setTimeout(res, 40)); // the join is made and the nonce is on its way
    const before = fakeFreed.pairing;
    device.dispose(); // the screen goes while the nonce is out
    await new Promise((res) => setTimeout(res, 500));
    expect(fakeFreed.pairing).toBeGreaterThan(before); // the join's session was given back
    expect(byDevice(r)).toHaveLength(1); // best effort, and only once
    approver.dispose();
  });

  it("an attempt that had already ended has already cancelled: no second cancel", async () => {
    const r = await createRig();
    const approver = new ApproverController(r.a.services, r.a.session, r.d.device);
    void approver.start();
    await until(() => approver.getState().phase === "waiting");
    r.delay.nonce = 300;
    const device = new DeviceController(r.d.services, r.d.session);
    void device.run();
    await new Promise((res) => setTimeout(res, 40)); // the join is made and the nonce is on its way
    await device.cancel(); // ends the attempt, and cancels
    await new Promise((res) => setTimeout(res, 500));
    expect(byDevice(r)).toHaveLength(1);
    approver.dispose();
  });
});

describe("the signature is checked inside the lock", () => {
  it("a cancel that comes while the confirmation waits for the lock stops it before it signs", async () => {
    const r = await createRig();
    const approver = new ApproverController(r.a.services, r.a.session, r.d.device);
    const device = new DeviceController(r.d.services, r.d.session);
    void approver.start();
    void device.run();
    await until(() => approver.getState().phase === "compare");
    let release!: () => void;
    const holding = r.a.services.engine.run(r.a.session, () => new Promise<void>((res) => (release = res)));
    void approver.confirm(); // reads the list, then queues behind the lock
    await until(() => approver.getState().phase === "confirming");
    await new Promise((res) => setTimeout(res, 60));
    await approver.cancel(); // while it waits
    release();
    await holding;
    await new Promise((res) => setTimeout(res, 80));
    expect(r.counts.sign).toBe(0);
    expect(calls(r, "/confirm")).toHaveLength(0);
    device.dispose();
  });
});

describe("replacing a device's keys is one transaction", () => {
  const old = () => ({ keys: new Uint8Array([1, 1]), identity: { accountId: "old", deviceId: "d", email: "old@example.com" } });

  async function withOldDevice() {
    const store = createIdbKeyStore();
    const wrap = await globalThis.crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    await store.saveKeys(old().keys);
    await store.saveIdentity(old().identity);
    await store.saveSnapshot(new Uint8Array([2]));
    await store.saveWrapKey(wrap);
    await store.quarantineSnapshot(new Uint8Array([3]));
    await store.saveSyncState({ ...emptySyncState(), zones: ["list:old"], lastSyncedAt: "2026-11-07T10:00:00Z" });
    await store.saveSession({ token: "t", accountId: "old", deviceId: "d", deviceState: "trusted", expiresAt: "2030-01-01T00:00:00Z", email: "old@example.com", name: "" });
    return { store, wrap };
  }

  it("writes the new keys, wrapping key and identity and clears the rest together, keeping the session", async () => {
    const { store } = await withOldDevice();
    const wrapKey = await globalThis.crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    await store.replaceDevice({ keys: new Uint8Array([9]), wrapKey, identity: { accountId: "new", deviceId: "d2", email: "new@example.com" } });
    expect(Array.from((await store.loadKeys())!)).toEqual([9]);
    expect(await store.loadIdentity()).toEqual({ accountId: "new", deviceId: "d2", email: "new@example.com" });
    expect(await store.loadWrapKey()).not.toBeNull();
    expect(await store.loadSnapshot()).toBeNull();
    expect(await store.loadQuarantine()).toEqual([]);
    expect(await store.loadSyncState()).toBeNull(); // the other account's sync state must not carry over
    expect((await store.loadSession())?.token).toBe("t");
  });

  it("the in-memory store clears the sync state too", async () => {
    const store = createMemoryKeyStore();
    await store.saveSyncState({ ...emptySyncState(), zones: ["list:old"] });
    await store.replaceDevice({ keys: new Uint8Array([1]), wrapKey: null, identity: { accountId: "n", deviceId: "d", email: "n@example.com" } });
    expect(await store.loadSyncState()).toBeNull();
  });

  it("a failure partway leaves the old device exactly as it was", async () => {
    const { store } = await withOldDevice();
    // The identity can't be stored (a function can't be cloned), after the other stores were already cleared and written.
    const bad = { accountId: "new", deviceId: "d2", email: "new@example.com", boom: () => 1 } as never;
    await expect(store.replaceDevice({ keys: new Uint8Array([9]), wrapKey: null, identity: bad })).rejects.toThrow();
    expect(Array.from((await store.loadKeys())!)).toEqual([1, 1]);
    expect(await store.loadIdentity()).toEqual(old().identity);
    expect(Array.from((await store.loadSnapshot())!)).toEqual([2]);
    expect(await store.loadWrapKey()).not.toBeNull();
    expect((await store.loadQuarantine()).map((b) => Array.from(b))).toEqual([[3]]);
    expect((await store.loadSyncState())?.zones).toEqual(["list:old"]); // and the sync state stays too
  });

  it("signing in to another account replaces the keys through it, and a store that fails leaves the old keys", async () => {
    const crypto = new FakeAuthCrypto();
    const engine = createMockEngine();
    const keys = createMemoryKeyStore();
    const services = createAuthServices({ fetch: engine.fetch, baseUrl: "http://e.test", keys, crypto: () => crypto, wrapSecret: async () => new Uint8Array(32).fill(3) });
    const first = await signedUp(engine, services, { name: "S", email: "s@example.com", password: "correct horse battery" });
    await signedUp(engine, createAuthServices({ fetch: engine.fetch, baseUrl: "http://e.test", keys: createMemoryKeyStore(), crypto: () => crypto, wrapSecret: async () => new Uint8Array(32).fill(4) }), { name: "A", email: "alex@example.com", password: "another long password" });
    await services.tokens.clear();
    const before = await keys.loadKeys();
    const real = keys.replaceDevice;
    keys.replaceDevice = async () => {
      throw new Error("crashed");
    };
    await expect(signIn(services, { email: "alex@example.com", password: "another long password", replaceKeys: true })).rejects.toThrow("crashed");
    expect(await keys.loadKeys()).toEqual(before);
    expect((await keys.loadIdentity())?.email).toBe("s@example.com");
    keys.replaceDevice = real;
    const next = await signIn(services, { email: "alex@example.com", password: "another long password", replaceKeys: true });
    expect(await keys.loadKeys()).not.toEqual(before);
    expect(await keys.loadIdentity()).toEqual({ accountId: next.accountId, deviceId: next.deviceId, email: "alex@example.com" });
    expect(next.accountId).not.toBe(first.accountId);
  });
});
