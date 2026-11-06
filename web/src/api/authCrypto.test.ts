import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SIGN_IN_UNAVAILABLE,
  SignInUnavailable,
  authCryptoAvailable,
  isAuthFailed,
  registerAuthCrypto,
  requireAuthCrypto,
} from "./authCrypto";
import { WasmAuthCrypto_forTests } from "./testing/wasmFake";
import { loadWasmAuthCrypto, wasmAuthCrypto } from "./WasmAuthCrypto";
import { FakeAuthCrypto } from "./testing/FakeAuthCrypto";
import { createAuthServices } from "../auth/services";
import { signIn, signUp } from "../auth/flows";
import { createMemoryKeyStore } from "./keyStore";

afterEach(() => registerAuthCrypto(null));

describe("when no real crypto is registered", () => {
  it("refuses, with the message for the person", () => {
    expect(authCryptoAvailable()).toBe(false);
    expect(() => requireAuthCrypto()).toThrow(SignInUnavailable);
    expect(SIGN_IN_UNAVAILABLE).toBe("Sign-in isn't available in this build yet");
    expect(() => requireAuthCrypto()).toThrow("Sign-in isn't available in this build yet");
  });

  it("sign-up and sign-in stop before anything is sent", async () => {
    const fetchMock = vi.fn();
    const services = createAuthServices({ fetch: fetchMock as unknown as typeof fetch, keys: createMemoryKeyStore() });
    await expect(signUp(services, { name: "Sam", email: "sam@example.com", password: "correct horse" })).rejects.toThrow(SIGN_IN_UNAVAILABLE);
    await expect(signIn(services, { email: "sam@example.com", password: "correct horse" })).rejects.toThrow(SIGN_IN_UNAVAILABLE);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses what is registered once something is", () => {
    const fake = new FakeAuthCrypto();
    registerAuthCrypto(fake);
    expect(authCryptoAvailable()).toBe(true);
    expect(requireAuthCrypto()).toBe(fake);
  });
});

describe("the WebAssembly adapter", () => {
  it("passes every call straight to the module's function of the same name", () => {
    const { module, log } = WasmAuthCrypto_forTests();
    const crypto = wasmAuthCrypto(module);
    const password = new Uint8Array([1, 2, 3]);
    const reg = crypto.startRegistration(password);
    crypto.finishRegistration(reg, password, new Uint8Array([9]));
    const login = crypto.startLogin(password);
    crypto.finishLogin(login, password, new Uint8Array([8]));
    const keys = crypto.deviceKeys.create();
    crypto.deviceKeys.import(new Uint8Array(64), new Uint8Array(32));
    expect(crypto.normalizeEmail(" A@B.co ")).toBe("a@b.co");
    expect(keys.signingKey()).toBe("signing");
    expect(log).toEqual([
      "startRegistration", "finishRegistration", "startLogin", "finishLogin", "DeviceKeys.create", "DeviceKeys.import", "normalizeEmail",
    ]);
  });

  it("approvals go to the module's SyncEngine, with JSON in and out", () => {
    const { module, log } = WasmAuthCrypto_forTests();
    const crypto = wasmAuthCrypto(module);
    const engine = crypto.engine.create(crypto.deviceKeys.create(), "acct", "dev");
    expect(engine.snapshot(new Uint8Array(32))).toEqual(new Uint8Array([1]));
    crypto.engine.restore(crypto.deviceKeys.create(), new Uint8Array([1]), new Uint8Array(32), 0);
    expect(engine.verifyDevices({ devices: [], removals: [] })).toEqual(["a"]);
    expect(engine.signRemoval({ id: "d" } as never)).toEqual({ sequence: 1, signature: "s" });
    const a = engine.startApproval({ id: "d" } as never, 1);
    expect(a.deviceFingerprint()).toBe("fp");
    expect(a.reveal({} as never)).toEqual({ nonce: "n" });
    expect(a.sas()).toBe("123456");
    expect(engine.confirmApproval(a, { devices: [], removals: [] })).toEqual({ signature: "s" });
    const d = engine.joinApproval({} as never, 2);
    expect(d.nonce).toEqual({ nonce: "d" });
    expect(d.sas({} as never)).toBe("123456");
    expect(engine.finishApproval(d, {} as never, undefined, 3)).toBe("123456");
    expect(log).toEqual(expect.arrayContaining(["SyncEngine.create", "SyncEngine.restore", "snapshot", "verifyDevices", "signRemoval", "startApproval", "reveal", "confirmApproval", "joinApproval", "finishApproval"]));
  });

  it("loading initialises the module and nothing registers it", async () => {
    const { module, log } = WasmAuthCrypto_forTests();
    const loader = vi.fn(async () => module);
    const crypto = await loadWasmAuthCrypto(loader);
    expect(log).toContain("init");
    expect(crypto.normalizeEmail("x")).toBe("x");
    expect(authCryptoAvailable()).toBe(false);
  });

  it("recognises the module's error for a wrong password", () => {
    expect(isAuthFailed(new Error("auth_failed: the password is wrong"))).toBe(true);
    expect(isAuthFailed(new Error("invalid_message: x"))).toBe(false);
    expect(isAuthFailed("auth_failed")).toBe(false);
  });
});
