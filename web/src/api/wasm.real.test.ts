// @vitest-environment node
//
// The engine's real module, run in Node through the planner's adapter. Nothing here is faked: these
// tests are what the fakes in src/api/testing have to agree with.
import { beforeAll, describe, expect, it } from "vitest";
import type { Device } from "../generated/Device";
import type { DeviceList } from "../generated/DeviceList";
import type { PendingApproval } from "../generated/PendingApproval";
import { decodeBytes, encodeBytes, utf8, uuidBytes } from "./bytes";
import { FakeAuthCrypto } from "./testing/FakeAuthCrypto";
import { DEVICE_LOGIN_CONTEXT, DEVICE_REGISTER_CONTEXT, TRUSTED_START_CONTEXT, loginMessage, registerMessage, trustedStartMessage } from "./testing/authMessages";
import { wasmAuthCrypto } from "./WasmAuthCrypto";
import type { AuthCrypto } from "./authCrypto";
import * as wasm from "../generated/wasm/orbyn_wasm.js";
import wasmBytes from "../generated/wasm/orbyn_wasm_bg.wasm?inline";

let crypto: AuthCrypto;
const wrap = Uint8Array.from({ length: 32 }, (_, i) => i + 1);

beforeAll(() => {
  // The .wasm arrives as a data: URL; Node has no fetch for files, so the bytes are decoded and handed over.
  wasm.initSync({ module: Uint8Array.from(atob(wasmBytes.slice(wasmBytes.indexOf(",") + 1)), (c) => c.charCodeAt(0)) });
  crypto = wasmAuthCrypto(wasm);
});

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof Error ? e.message.split(":")[0] : String(e);
  }
  return "no error";
};

/** What `DeviceKeys.sign` signs: the context's length as 8 bytes (big endian), the context, the message. */
function framed(context: string, message: Uint8Array): Uint8Array {
  const head = new Uint8Array(8);
  new DataView(head.buffer).setBigUint64(0, BigInt(utf8(context).length));
  return Uint8Array.from([...head, ...utf8(context), ...message]);
}

const buffer = (bytes: Uint8Array): ArrayBuffer => bytes.slice().buffer as ArrayBuffer;

async function verifies(signingKey: string, context: string, message: Uint8Array, signature: Uint8Array): Promise<boolean> {
  const key = await globalThis.crypto.subtle.importKey("raw", buffer(decodeBytes(signingKey)), { name: "Ed25519" }, false, ["verify"]);
  return globalThis.crypto.subtle.verify({ name: "Ed25519" }, key, buffer(signature), buffer(framed(context, message)));
}

describe("device keys", () => {
  it("export seals the keys under the wrapping secret, and import opens them", () => {
    const keys = crypto.deviceKeys.create();
    expect(keys.signingKey()).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(keys.agreementKey()).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const sealed = keys.export(wrap);
    expect(sealed[0]).toBe(1); // the format byte
    expect(sealed.length).toBeGreaterThan(64 + 24); // sealed bytes plus nonce and tag, not the bare 64
    const again = crypto.deviceKeys.import(sealed, wrap);
    expect(again.signingKey()).toBe(keys.signingKey());
    expect(again.agreementKey()).toBe(keys.agreementKey());
    expect(Array.from(keys.export(wrap))).not.toEqual(Array.from(sealed)); // a fresh nonce every time
  });

  it("refuses another secret, changed bytes and a secret that is too short, each with its code", () => {
    const sealed = crypto.deviceKeys.create().export(wrap);
    expect(code(() => crypto.deviceKeys.import(sealed, Uint8Array.from({ length: 32 }, () => 9)))).toBe("open_failed");
    const flipped = sealed.slice();
    flipped[flipped.length - 1] = flipped[flipped.length - 1]! ^ 1;
    expect(code(() => crypto.deviceKeys.import(flipped, wrap))).toBe("open_failed");
    expect(code(() => crypto.deviceKeys.import(sealed.slice(0, 10), wrap))).toBe("open_failed");
    expect(code(() => crypto.deviceKeys.import(new Uint8Array(0), wrap))).toBe("open_failed");
    expect(code(() => crypto.deviceKeys.import(sealed, new Uint8Array(16)))).toBe("invalid_wrap_secret");
    expect(code(() => crypto.deviceKeys.create().export(new Uint8Array(16)))).toBe("invalid_wrap_secret");
  });

  it("signatures are Ed25519 over the length-prefixed context and message", async () => {
    const keys = crypto.deviceKeys.create();
    const message = utf8("hello");
    const signature = keys.sign("test/context", message);
    expect(signature).toHaveLength(64);
    expect(await verifies(keys.signingKey(), "test/context", message, signature)).toBe(true);
    expect(await verifies(keys.signingKey(), "test/other", message, signature)).toBe(false);
    expect(await verifies(keys.signingKey(), "test/context", utf8("hullo"), signature)).toBe(false);
    expect(await verifies(crypto.deviceKeys.create().signingKey(), "test/context", message, signature)).toBe(false);
  });

  it("the sign-up, sign-in and trusted-start signatures cover exactly the messages the engine builds", async () => {
    const keys = crypto.deviceKeys.create();
    const pub = { signing: decodeBytes(keys.signingKey()), agreement: decodeBytes(keys.agreementKey()) };
    const upload = Uint8Array.from([1, 2, 3, 4]);
    // The email is normalised before it is signed.
    const reg = keys.signRegistration("  Sam@Example.COM ", upload);
    expect(await verifies(keys.signingKey(), DEVICE_REGISTER_CONTEXT, registerMessage("sam@example.com", upload, pub), reg)).toBe(true);
    const loginId = "0f8fad5b-d9cb-469f-a165-70867728950e";
    const login = keys.signLogin(loginId);
    expect(await verifies(keys.signingKey(), DEVICE_LOGIN_CONTEXT, loginMessage(loginId, pub), login)).toBe(true);
    const request = Uint8Array.from([9, 9, 9]);
    const start = keys.signTrustedStart("Sam@Example.com", request, 1_794_000_000);
    expect(await verifies(keys.signingKey(), TRUSTED_START_CONTEXT, trustedStartMessage("sam@example.com", request, 1_794_000_000), start)).toBe(true);
    expect(code(() => keys.signRegistration("not an email", upload))).toBe("invalid_email");
    expect(code(() => keys.signTrustedStart("nope", request, 1))).toBe("invalid_email");
    expect(code(() => keys.signLogin("not-a-uuid"))).toBe("invalid_input");
    void uuidBytes;
  });
});

describe("sign-in messages", () => {
  it("starting gives a request, and any protocol failure reads as auth_failed", () => {
    const password = utf8("correct horse battery");
    const reg = crypto.startRegistration(password);
    expect(reg.request.length).toBeGreaterThan(16);
    expect(code(() => crypto.finishRegistration(reg, password, Uint8Array.from([1, 2, 3])))).toBe("auth_failed");
    const login = crypto.startLogin(password);
    expect(code(() => crypto.finishLogin(login, password, Uint8Array.from([1, 2, 3])))).toBe("auth_failed");
    // Each pending value works once.
    expect(code(() => crypto.finishLogin(login, password, Uint8Array.from([1, 2, 3])))).toBe("already_finished");
  });

  it("normalises email like the stand-in does", () => {
    const fake = new FakeAuthCrypto();
    for (const e of ["  Ada@Example.COM ", "ada@example.com", "", "ada", "@example.com", "ada@", "a b@example.com", "a@b@c", "ada@.com", "ada@example.", `${"x".repeat(65)}@example.com`, "a@b\u0000.c"]) {
      expect(crypto.normalizeEmail(e), JSON.stringify(e)).toBe(fake.normalizeEmail(e));
    }
  });
});

describe("the engine's saved state", () => {
  const ACCOUNT = "00000000-0000-4000-8000-0000000000a1";
  const DEVICE = "00000000-0000-4000-8000-0000000000a2";

  it("snapshot seals the engine and restore opens it", () => {
    const keys = crypto.deviceKeys.create();
    const engine = crypto.engine.create(keys, ACCOUNT, DEVICE);
    const sealed = engine.snapshot(wrap);
    expect(sealed[0]).toBe(1);
    const restored = crypto.engine.restore(keys, sealed, wrap, Date.now());
    expect(restored.snapshot(wrap)).toHaveLength(sealed.length);
  });

  it("restore says open_failed for another secret, other keys, changed bytes and a blob of another purpose", () => {
    const keys = crypto.deviceKeys.create();
    const sealed = crypto.engine.create(keys, ACCOUNT, DEVICE).snapshot(wrap);
    const other = Uint8Array.from({ length: 32 }, () => 7);
    expect(code(() => crypto.engine.restore(keys, sealed, other, 0))).toBe("open_failed");
    expect(code(() => crypto.engine.restore(crypto.deviceKeys.create(), sealed, wrap, 0))).toBe("open_failed"); // bound to the signing key
    const flipped = sealed.slice();
    flipped[20] = flipped[20]! ^ 0xff;
    expect(code(() => crypto.engine.restore(keys, flipped, wrap, 0))).toBe("open_failed");
    expect(code(() => crypto.engine.restore(keys, keys.export(wrap), wrap, 0))).toBe("open_failed"); // device-keys blob is not a snapshot
  });

  it("a secret that is too short and bad JSON are other codes, not open_failed", () => {
    const keys = crypto.deviceKeys.create();
    const sealed = crypto.engine.create(keys, ACCOUNT, DEVICE).snapshot(wrap);
    expect(code(() => crypto.engine.restore(keys, sealed, new Uint8Array(8), 0))).toBe("invalid_wrap_secret");
    const engine = crypto.engine.create(keys, ACCOUNT, DEVICE);
    expect(code(() => engine.verifyDevices({ nope: true } as unknown as DeviceList))).toBe("invalid_json");
  });

  it("a fresh engine trusts only itself, and counts removals only from devices it trusts", () => {
    const keys = crypto.deviceKeys.create();
    const engine = crypto.engine.create(keys, ACCOUNT, DEVICE);
    const me: Device = {
      id: DEVICE, name: "me", platform: "web", state: "trusted", signing_key: keys.signingKey(), agreement_key: keys.agreementKey(),
      created_at: "2026-11-07T10:00:00Z", approved_by: null, approval_signature: null, current: true,
    };
    expect(engine.verifyDevices({ devices: [me], removals: [] })).toEqual([DEVICE]);
    const target = { ...me, id: "00000000-0000-4000-8000-0000000000b1", current: false, signing_key: crypto.deviceKeys.create().signingKey() };
    const first = engine.signRemoval(target);
    expect(first.sequence).toBe(1);
    expect(decodeBytes(first.signature)).toHaveLength(64);
    // Signing doesn't count it: only a list that shows it does.
    expect(engine.signRemoval(target).sequence).toBe(1);
  });
});

describe("the two-way pairing, without a server", () => {
  const ACCOUNT = "00000000-0000-4000-8000-0000000000a1";
  const ID_A = "00000000-0000-4000-8000-0000000000a2";
  const ID_D = "00000000-0000-4000-8000-0000000000d2";
  const NOW = 1_794_000_000;

  it("both sides compute the same six digits, and the new device pins the approver", () => {
    const ka = crypto.deviceKeys.create();
    const kd = crypto.deviceKeys.create();
    const a = crypto.engine.create(ka, ACCOUNT, ID_A);
    const d = crypto.engine.create(kd, ACCOUNT, ID_D);
    const device = (id: string, k: typeof ka, state: Device["state"], current: boolean): Device => ({
      id, name: id === ID_A ? "A" : "D", platform: "web", state, signing_key: k.signingKey(), agreement_key: k.agreementKey(),
      created_at: "2026-11-07T10:00:00Z", approved_by: null, approval_signature: null, current,
    });
    const pending = device(ID_D, kd, "pending", false);

    const sa = a.startApproval(pending, NOW);
    const create = sa.createRequest;
    expect(Object.keys(create).sort()).toEqual(["approval_id", "commitment", "created_at", "device_id"]);
    const view = (extra: Partial<PendingApproval> = {}): PendingApproval => ({
      id: create.approval_id, expires_at: "2026-11-07T10:10:00Z", created_at: NOW, approver_id: ID_A, approver_signing_key: ka.signingKey(),
      approver_agreement_key: ka.agreementKey(), device_id: ID_D, device_signing_key: kd.signingKey(), device_agreement_key: kd.agreementKey(),
      commitment: create.commitment, device_nonce: null, approver_nonce: null, signature: null, endorsement: null, ...extra,
    });

    const sd = d.joinApproval(view(), NOW);
    const reveal = sa.reveal(view({ device_nonce: sd.nonce.nonce }));
    const digitsA = sa.sas();
    const digitsD = sd.sas(view({ device_nonce: sd.nonce.nonce, approver_nonce: reveal.nonce }));
    expect(digitsA).toMatch(/^\d{6}$/);
    expect(digitsD).toBe(digitsA);
    expect(sa.deviceFingerprint()).toMatch(/\S/);

    const list: DeviceList = { devices: [device(ID_A, ka, "trusted", true), { ...pending }], removals: [] };
    const confirm = a.confirmApproval(sa, list);
    expect(decodeBytes(confirm.signature)).toHaveLength(64);
    expect(confirm.endorsement).toBeTruthy();
    const full = view({ device_nonce: sd.nonce.nonce, approver_nonce: reveal.nonce, signature: confirm.signature, endorsement: confirm.endorsement ?? null });
    expect(d.finishApproval(sd, full, undefined, NOW)).toBe(digitsA);
    // The new device now pins the approver, so the approver is verified though nothing links it by a chain.
    const seenByD: DeviceList = { devices: [{ ...device(ID_A, ka, "trusted", false) }, { ...device(ID_D, kd, "trusted", true) }], removals: [] };
    expect(d.verifyDevices(seenByD).sort()).toEqual([ID_A, ID_D].sort());
    // One attempt: a session works once.
    expect(code(() => d.finishApproval(sd, full, undefined, NOW))).toBe("already_finished");
    expect(code(() => a.confirmApproval(sa, list))).toBe("already_finished");
  });

  it("refuses wrong typed digits, keys the server swapped, and an approval older than ten minutes", () => {
    const ka = crypto.deviceKeys.create();
    const kd = crypto.deviceKeys.create();
    const a = crypto.engine.create(ka, ACCOUNT, ID_A);
    const d = crypto.engine.create(kd, ACCOUNT, ID_D);
    const pending: Device = {
      id: ID_D, name: "D", platform: "web", state: "pending", signing_key: kd.signingKey(), agreement_key: kd.agreementKey(),
      created_at: "2026-11-07T10:00:00Z", approved_by: null, approval_signature: null, current: false,
    };
    const sa = a.startApproval(pending, NOW);
    const base: PendingApproval = {
      id: sa.createRequest.approval_id, expires_at: "x", created_at: NOW, approver_id: ID_A, approver_signing_key: ka.signingKey(),
      approver_agreement_key: ka.agreementKey(), device_id: ID_D, device_signing_key: kd.signingKey(), device_agreement_key: kd.agreementKey(),
      commitment: sa.createRequest.commitment, device_nonce: null, approver_nonce: null, signature: null, endorsement: null,
    };
    expect(code(() => d.joinApproval(base, NOW + 601))).toBe("mismatch");
    const sd = d.joinApproval(base, NOW);
    // Confirming before anything was revealed is refused too.
    expect(code(() => a.confirmApproval(a.startApproval(pending, NOW), { devices: [], removals: [] }))).toBe("mismatch");
    // The server shows the approver other keys for the new device than it started with.
    expect(code(() => sa.reveal({ ...base, device_nonce: sd.nonce.nonce, device_signing_key: ka.signingKey() }))).toBe("mismatch");
    expect(code(() => sa.reveal(base))).toBe("mismatch"); // no nonce from the new device yet
    const reveal = sa.reveal({ ...base, device_nonce: sd.nonce.nonce });
    const withNonce = { ...base, device_nonce: sd.nonce.nonce, approver_nonce: reveal.nonce };
    const forged = encodeBytes(new Uint8Array(32).fill(3));
    expect(code(() => sd.sas({ ...withNonce, approver_nonce: forged }))).toBe("mismatch");
    expect(code(() => sd.sas(base))).toBe("mismatch");
    const confirm = a.confirmApproval(sa, { devices: [{ ...pending, id: ID_A, signing_key: ka.signingKey(), agreement_key: ka.agreementKey(), state: "trusted", current: true }, pending], removals: [] });
    const done = { ...withNonce, signature: confirm.signature, endorsement: confirm.endorsement ?? null };
    // Every refusal of the pairing is the one code `mismatch`; only a second use is `already_finished`.
    const unsigned = { ...withNonce };
    expect(code(() => d.finishApproval(crypto.engine.create(kd, ACCOUNT, ID_D).joinApproval(base, NOW), unsigned, undefined, NOW))).toBe("mismatch");
    expect(code(() => d.finishApproval(sd, { ...done, signature: encodeBytes(new Uint8Array(64)) }, undefined, NOW))).toBe("mismatch");
  });
});
