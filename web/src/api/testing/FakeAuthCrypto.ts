import type { DeviceList } from "../../generated/DeviceList";
import type { ApprovalEngine, ApproverPairing, AuthCrypto, DeviceKeys, DevicePairing, PendingLogin, PendingRegistration } from "../authCrypto";
import { fakeProtection, type ProtectionState } from "./protectionFake";
import { APPROVAL_CONTEXT, confirmMessage, fakeCommitment, fakeSas, pairingBytes, partsOfView, type PairingParts } from "./fakePairing";
import { concat, decodeBytes, encodeBytes, utf8 } from "../bytes";
import {
  DEVICE_LOGIN_CONTEXT,
  DEVICE_REGISTER_CONTEXT,
  ACCOUNT_DELETE_CANCEL_CONTEXT,
  ACCOUNT_DELETE_CONTEXT,
  accountDeleteMessage,
  TOTP_MANAGE_CONTEXT,
  totpManageMessage,
  TRUSTED_START_CONTEXT,
  loginMessage,
  normalizeEmail,
  registerMessage,
  trustedStartMessage,
} from "./authMessages";

/**
 * A stand-in for the real OPAQUE and Ed25519 code, for tests ONLY. It is not secure and must never
 * be imported by anything that is built into the app; a test checks that and checks the build.
 */
export const FAKE_AUTH_MARKER = "orbyn-fake-auth-crypto-DO-NOT-SHIP";

/** A 32-byte tag of some parts, enough for a mock server to tell a right answer from a wrong one. */
export function fakeDigest(...parts: Uint8Array[]): Uint8Array {
  const input = concat(...parts);
  const out = new Uint8Array(32);
  let h = 2166136261;
  for (let round = 0; round < 32; round++) {
    for (const b of input) h = Math.imul(h ^ b ^ round, 16777619) >>> 0;
    out[round] = h & 0xff;
  }
  return out;
}

const passwordTag = (password: Uint8Array) => fakeDigest(utf8("pw"), password);

export function fakeSignature(signing: Uint8Array, context: string, message: Uint8Array): Uint8Array {
  const half = fakeDigest(signing, utf8(context), message);
  return concat(half, fakeDigest(half, signing));
}

export function fakeVerify(signing: Uint8Array, context: string, message: Uint8Array, signature: Uint8Array): boolean {
  const want = fakeSignature(signing, context, message);
  return signature.length === 64 && want.every((b, i) => b === signature[i]);
}

/** What the mock server stores for a password, and checks at sign-in. */
export const fakeVerifierFor = (password: string) => passwordTag(utf8(password));

let counter = 0;

/** How many times each kind of object was released, so a test can see that nothing is left to the module. */
export const fakeFreed = { keys: 0, engine: 0, pairing: 0 };

class FakeDeviceKeys implements DeviceKeys {
  constructor(private readonly signing: Uint8Array, private readonly agreement: Uint8Array) {}

  free() {
    fakeFreed.keys += 1;
  }

  export(wrapSecret: Uint8Array) {
    return fakeSeal(wrapSecret, "keys", concat(this.signing, this.agreement));
  }
  signingKey() {
    return encodeBytes(this.signing);
  }
  agreementKey() {
    return encodeBytes(this.agreement);
  }
  sign(context: string, message: Uint8Array) {
    return fakeSignature(this.signing, context, message);
  }
  signRegistration(email: string, upload: Uint8Array) {
    const normal = normalizeEmail(email);
    if (!normal) throw new Error("invalid_email: not an email");
    return this.sign(DEVICE_REGISTER_CONTEXT, registerMessage(normal, upload, { signing: this.signing, agreement: this.agreement }));
  }
  signLogin(loginId: string) {
    return this.sign(DEVICE_LOGIN_CONTEXT, loginMessage(loginId, { signing: this.signing, agreement: this.agreement }));
  }
  signAccountDelete(accountId: string, deviceId: string, signedAt: number) {
    return this.sign(ACCOUNT_DELETE_CONTEXT, accountDeleteMessage(accountId, deviceId, signedAt));
  }
  signAccountDeleteCancel(accountId: string, deviceId: string, signedAt: number) {
    return this.sign(ACCOUNT_DELETE_CANCEL_CONTEXT, accountDeleteMessage(accountId, deviceId, signedAt));
  }
  signTotpManage(accountId: string, deviceId: string, action: string, code: string, signedAt: number) {
    if (!["enrol", "confirm", "disable"].includes(action)) throw new Error("invalid_input: the action is enrol, confirm or disable");
    return this.sign(TOTP_MANAGE_CONTEXT, totpManageMessage(accountId, deviceId, action, code, signedAt));
  }
  signTrustedStart(email: string, credentialRequest: Uint8Array, signedAt: number) {
    const normal = normalizeEmail(email);
    if (!normal) throw new Error("invalid_email: not an email");
    return this.sign(TRUSTED_START_CONTEXT, trustedStartMessage(normal, credentialRequest, signedAt));
  }
}

export class FakeAuthCrypto implements AuthCrypto {
  readonly marker = FAKE_AUTH_MARKER;

  startRegistration(): PendingRegistration {
    return { request: utf8("fake-registration-request") };
  }

  finishRegistration(_pending: PendingRegistration, password: Uint8Array, response: Uint8Array) {
    if (new TextDecoder().decode(response) !== "fake-registration-response") throw new Error("invalid_message: not the server's answer");
    return concat(utf8("fake-upload:"), passwordTag(password));
  }

  startLogin(): PendingLogin {
    return { request: utf8("fake-login-request") };
  }

  finishLogin(_pending: PendingLogin, password: Uint8Array, response: Uint8Array) {
    // The server's response carries the verifier; a wrong password does not match, on the device.
    const verifier = response.slice("fake-login-response:".length);
    if (!passwordTag(password).every((b, i) => b === verifier[i])) throw new Error("auth_failed: the password is wrong or the server could not be verified");
    return utf8("fake-login-finalization");
  }

  deviceKeys = {
    create: (): DeviceKeys => {
      const n = ++counter;
      return new FakeDeviceKeys(fakeDigest(utf8("signing"), utf8(String(n)), utf8(String(Math.random()))), fakeDigest(utf8("agreement"), utf8(String(n)), utf8(String(Math.random()))));
    },
    import: (sealed: Uint8Array, wrapSecret: Uint8Array): DeviceKeys => {
      const bytes = fakeOpen(wrapSecret, "keys", sealed);
      return new FakeDeviceKeys(bytes.slice(0, 32), bytes.slice(32, 64));
    },
  };

  engine: AuthCrypto["engine"] = {
    create: (keys: DeviceKeys, accountId: string, deviceId: string): ApprovalEngine => fakeApprovals(keys, accountId, deviceId, { pinned: [deviceId], counted: 0 }),
    restore: (keys: DeviceKeys, sealed: Uint8Array, wrapSecret: Uint8Array): ApprovalEngine => {
      let state: { accountId: string; deviceId: string; signing: string; pinned: string[]; counted: number; protection?: ProtectionState };
      const plain = fakeOpen(wrapSecret, "snapshot", sealed); // throws open_failed
      try {
        state = JSON.parse(new TextDecoder().decode(plain));
      } catch {
        throw new Error("invalid_json: the snapshot is not in a format this version reads");
      }
      if (state.signing !== keys.signingKey()) throw new Error("open_failed: this snapshot belongs to other keys");
      return fakeApprovals(keys, state.accountId, state.deviceId, state);
    },
  };

  normalizeEmail(email: string) {
    return normalizeEmail(email) ?? undefined;
  }
}

/**
 * Stand-in sealing for tests ONLY: hides the bytes under the wrapping secret and refuses another
 * secret, so a test can check that what is stored is sealed. The real one is XChaCha20-Poly1305 in the module.
 */
function keystream(secret: Uint8Array, purpose: string, n: number): Uint8Array {
  // The real module refuses a wrapping secret under 32 bytes.
  if (secret.length < 32) throw new Error("invalid_wrap_secret: the wrapping secret must be 32 bytes or more");
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i += 32) out.set(fakeDigest(secret, utf8(purpose), utf8(String(i))).slice(0, Math.min(32, n - i)), i);
  return out;
}
export function fakeSeal(secret: Uint8Array, purpose: string, plain: Uint8Array): Uint8Array {
  const ks = keystream(secret, purpose, plain.length);
  const tag = fakeDigest(secret, utf8(purpose), plain).slice(0, 8);
  return concat(tag, plain.map((b, i) => b ^ ks[i]!));
}
export function fakeOpen(secret: Uint8Array, purpose: string, sealed: Uint8Array): Uint8Array {
  const ks = keystream(secret, purpose, Math.max(sealed.length - 8, 0));
  const plain = sealed.slice(8).map((b, i) => b ^ ks[i]!);
  const tag = fakeDigest(secret, utf8(purpose), plain).slice(0, 8);
  if (sealed.length < 8 || !tag.every((b, i) => b === sealed[i])) throw new Error("open_failed: wrong wrapping secret or changed bytes");
  return plain;
}

const approver = new WeakMap<object, { parts: PairingParts; pairing: Uint8Array; rA: Uint8Array; rD?: Uint8Array; used: boolean }>();
const device = new WeakMap<object, { pairing: Uint8Array; rD: Uint8Array; used: boolean; approverSigning: string }>();
const random32 = () => Uint8Array.from({ length: 32 }, () => Math.floor(Math.random() * 256));
const ten = 600;

/** Approval functions with the same order and refusals as the engine's, over the stand-in hash. */
function fakeApprovals(keys: DeviceKeys, accountId: string, deviceId: string, initial: { pinned: string[]; counted: number; protection?: ProtectionState }): ApprovalEngine {
  const protection: ProtectionState = initial.protection ?? { head: null, complete: false };
  /** What this engine has counted: removals seen in a verified list, and the devices it pins. */
  let counted = initial.counted;
  const pinned = new Set<string>(initial.pinned);
  const verifiedIds = (list: DeviceList) => engine.verifyDevices(list);
  const engine: ApprovalEngine = {
    protection: fakeProtection(keys, accountId, deviceId, protection, verifiedIds),
    free() {
      fakeFreed.engine += 1;
    },
    snapshot(wrapSecret) {
      const state = { accountId, deviceId, signing: keys.signingKey(), pinned: [...pinned], counted, protection };
      return fakeSeal(wrapSecret, "snapshot", utf8(JSON.stringify(state)));
    },
    verifyDevices(list) {
      // A removal counts when a device this one pins made it.
      for (const r of list.removals) if (pinned.has(r.removed_by)) counted = Math.max(counted, r.sequence);
      // Devices linked to a pinned one by a recorded approval become pinned; the server's `state` is not used.
      for (let grew = true; grew; ) {
        grew = false;
        for (const d of list.devices) {
          if (!pinned.has(d.id) && d.approval_signature && d.approved_by && pinned.has(d.approved_by)) {
            pinned.add(d.id);
            grew = true;
          }
        }
      }
      return [...pinned].filter((id) => list.devices.some((d) => d.id === id));
    },
    signRemoval(target) {
      const sequence = counted + 1;
      return { sequence, signature: encodeBytes(keys.sign("orbyn/device-removal/v1", utf8(`${accountId}|${target.id}|${target.signing_key}|${target.agreement_key}|${sequence}`))) };
    },
    startApproval(target, nowSecs) {
      if (pinned.has(target.id)) throw new Error("invalid_input: this device already trusts that one");
      const parts: PairingParts = {
        accountId, approvalId: `${Math.random().toString(16).slice(2, 10)}-${nowSecs}-${target.id}`.padEnd(36, "0").slice(0, 36), createdAt: nowSecs, approverId: deviceId,
        approverSigning: keys.signingKey(), approverAgreement: keys.agreementKey(), deviceId: target.id, deviceSigning: target.signing_key, deviceAgreement: target.agreement_key,
      };
      // A real approval id is a UUID the approver makes.
      parts.approvalId = `00000000-0000-4000-9000-${String(Math.floor(Math.random() * 1e12)).padStart(12, "0")}`;
      const pairing = pairingBytes(parts);
      const rA = random32();
      const state = { parts, pairing, rA, rD: undefined as Uint8Array | undefined, used: false };
      const session: ApproverPairing = {
        free: () => void (fakeFreed.pairing += 1),
        createRequest: { approval_id: parts.approvalId, device_id: target.id, created_at: nowSecs, commitment: encodeBytes(fakeCommitment(pairing, rA)) },
        deviceFingerprint: () => {
          const d = fakeDigest(utf8("fingerprint"), decodeBytes(target.signing_key), decodeBytes(target.agreement_key));
          return [...d.slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("").replace(/(.{4})/g, "$1 ").trim().toUpperCase();
        },
        reveal(view) {
          if (view.device_signing_key !== parts.deviceSigning || view.device_agreement_key !== parts.deviceAgreement || view.device_id !== parts.deviceId || view.id !== parts.approvalId) {
            throw new Error("mismatch: the answer does not match the upload"); // the real module: one code for every disagreement
          }
          if (!view.device_nonce) throw new Error("mismatch: the answer does not match the upload");
          state.rD = decodeBytes(view.device_nonce);
          return { nonce: encodeBytes(state.rA) };
        },
        sas: () => (state.rD ? fakeSas(pairing, state.rA, state.rD) : undefined),
      };
      approver.set(session, state);
      return session;
    },
    confirmApproval(session) {
      const state = approver.get(session);
      if (!state || state.used) throw new Error("already_finished: this approval was used");
      const rD = state.rD;
      if (!rD) throw new Error("mismatch: the answer does not match the upload"); // nothing was revealed yet
      state.used = true;
      return {
        signature: encodeBytes(keys.sign(APPROVAL_CONTEXT, confirmMessage(state.pairing, state.rA, rD))),
        endorsement: encodeBytes(keys.sign("orbyn/approval-endorsement/v2", state.pairing)),
      };
    },
    joinApproval(view, nowSecs) {
      if (nowSecs - view.created_at > ten) throw new Error("mismatch: the answer does not match the upload");
      const pairing = pairingBytes(partsOfView(accountId, view));
      const rD = random32();
      const session: DevicePairing = {
        free: () => void (fakeFreed.pairing += 1),
        nonce: { nonce: encodeBytes(rD) },
        sas(v) {
          if (!v.approver_nonce) throw new Error("mismatch: the answer does not match the upload");
          const rA = decodeBytes(v.approver_nonce);
          if (encodeBytes(fakeCommitment(pairing, rA)) !== v.commitment) throw new Error("mismatch: the answer does not match the upload");
          return fakeSas(pairing, rA, rD);
        },
      };
      device.set(session, { pairing, rD, used: false, approverSigning: view.approver_signing_key });
      return session;
    },
    finishApproval(session, view, typed, nowSecs) {
      const state = device.get(session);
      if (!state || state.used) throw new Error("already_finished: this approval was used");
      if (!view.signature || !view.approver_nonce) throw new Error("mismatch: the answer does not match the upload");
      pinned.add(view.approver_id);
      state.used = true;
      if (nowSecs - view.created_at > ten) throw new Error("mismatch: the answer does not match the upload");
      const rA = decodeBytes(view.approver_nonce);
      if (encodeBytes(fakeCommitment(state.pairing, rA)) !== view.commitment) throw new Error("mismatch: the answer does not match the upload");
      if (!fakeVerify(decodeBytes(state.approverSigning), APPROVAL_CONTEXT, confirmMessage(state.pairing, rA, state.rD), decodeBytes(view.signature))) {
        throw new Error("mismatch: the answer does not match the upload");
      }
      const sas = fakeSas(state.pairing, rA, state.rD);
      if (typed !== undefined && typed.replace(/\s+/g, "") !== sas) throw new Error("mismatch: the answer does not match the upload");
      return sas;
    },
  };
  return engine;
}
