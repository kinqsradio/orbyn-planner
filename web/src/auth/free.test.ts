import { describe, expect, it } from "vitest";
import { createMemoryKeyStore, type StoredSession } from "../api/keyStore";
import { encodeBytes } from "../api/bytes";
import { FakeAuthCrypto, fakeFreed } from "../api/testing/FakeAuthCrypto";
import { WasmAuthCrypto_forTests } from "../api/testing/wasmFake";
import { createMockEngine } from "../api/testing/MockEngine";
import { wasmAuthCrypto } from "../api/WasmAuthCrypto";
import { createEngineHost } from "./engineHost";
import { signIn, signUp } from "./flows";
import { DIGITS_MISMATCH, ApproverController, DeviceController } from "./pairing";
import { createAuthServices } from "./services";
import { calls, createRig, until } from "./testing/rig";

const session: StoredSession = { token: "t", accountId: "a", deviceId: "d", deviceState: "trusted", expiresAt: "2030-01-01T00:00:00Z", email: "a@b.co", name: "" };

describe("the module's memory is given back", () => {
  it("the engine host frees the engine and the keys after each action, also when it fails", async () => {
    const { module, log } = WasmAuthCrypto_forTests();
    const keys = createMemoryKeyStore();
    await keys.saveKeys(new Uint8Array(3));
    const host = createEngineHost({ keys, crypto: () => wasmAuthCrypto(module), wrapSecret: async () => new Uint8Array(32), wrapKeyPresent: async () => true, now: () => 0 });
    await host.run(session, () => 1);
    expect(log.filter((x) => x === "SyncEngine.free")).toHaveLength(1);
    expect(log.filter((x) => x === "DeviceKeys.free")).toHaveLength(1);
    await expect(host.run(session, () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(log.filter((x) => x === "SyncEngine.free")).toHaveLength(2);
    expect(log.filter((x) => x === "DeviceKeys.free")).toHaveLength(2);
  });

  it("the adapter frees a session through the module's own object", () => {
    const { module, log } = WasmAuthCrypto_forTests();
    const engine = wasmAuthCrypto(module).engine.create({} as never, "a", "d");
    const approver = engine.startApproval({ id: "x" } as never, 1);
    const device = engine.joinApproval({} as never, 1);
    approver.free();
    device.free();
    engine.free();
    expect(log).toEqual(expect.arrayContaining(["ApproverSession.free", "DeviceSession.free", "SyncEngine.free"]));
  });

  it("sign-up and sign-in free the keys they held", async () => {
    const crypto = new FakeAuthCrypto();
    const engine = createMockEngine();
    const keys = createMemoryKeyStore();
    const services = createAuthServices({ fetch: engine.fetch, baseUrl: "http://e.test", keys, crypto: () => crypto, wrapSecret: async () => new Uint8Array(32).fill(2) });
    const before = fakeFreed.keys;
    await signUp(services, { name: "S", email: "s@example.com", password: "correct horse battery" });
    expect(fakeFreed.keys).toBe(before + 1);
    await keys.clearSession();
    await services.tokens.clear();
    const mid = fakeFreed.keys;
    await signIn(services, { email: "s@example.com", password: "correct horse battery" });
    expect(fakeFreed.keys).toBe(mid + 1);
    void encodeBytes;
  });

  it("an approval's sessions are freed when it ends, on both sides", async () => {
    const r = await createRig();
    const approver = new ApproverController(r.a.services, r.a.session, r.d.device);
    const device = new DeviceController(r.d.services, r.d.session);
    void approver.start();
    void device.run();
    await until(() => approver.getState().phase === "compare" && device.getState().phase === "compare");
    const before = fakeFreed.pairing;
    await approver.cancel();
    await until(() => device.getState().phase === "closed");
    expect(fakeFreed.pairing).toBe(before + 2);
    device.dispose(); // closing again frees nothing twice
    approver.dispose();
    expect(fakeFreed.pairing).toBe(before + 2);
  });
});

describe("what a refusal says", () => {
  it("a disagreement before the person compares is plain; right after their own comparison it is about the digits", async () => {
    const r = await createRig();
    const approver = new ApproverController(r.a.services, r.a.session, r.d.device);
    r.tamper.approverNonce = encodeBytes(new Uint8Array(32).fill(5)); // the new device is shown a nonce that doesn't match its commitment
    const device = new DeviceController(r.d.services, r.d.session);
    void approver.start();
    void device.run();
    await until(() => device.getState().phase === "closed");
    expect(device.getState()).toMatchObject({ reason: "mismatch", message: "The two devices didn’t agree. Start again from the other device." });
    approver.dispose();

    const q = await createRig();
    const a2 = new ApproverController(q.a.services, q.a.session, q.d.device);
    const d2 = new DeviceController(q.d.services, q.d.session);
    void a2.start();
    void d2.run();
    await until(() => a2.getState().phase === "compare" && d2.getState().phase === "compare");
    void a2.confirm();
    await until(() => a2.getState().phase === "finishing");
    d2.confirm("000000");
    await until(() => d2.getState().phase === "closed");
    expect(d2.getState()).toMatchObject({ reason: "mismatch", message: DIGITS_MISMATCH });
    a2.dispose();
    expect(calls(q, "/code")).toHaveLength(0);
  });
});
