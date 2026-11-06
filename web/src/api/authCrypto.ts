/**
 * The OPAQUE password protocol and the device keys (Ed25519 for signing, X25519 for agreement),
 * shaped to match the engine's WebAssembly module, orbyn-wasm, name for name (its README has the
 * table). Passwords and messages go in and out as bytes, public keys as base64url, and a failure
 * throws an `Error` whose message starts with a stable code, such as `auth_failed: ...` for a wrong
 * password. The planner builds and signs no protocol message itself: the module does, under the
 * engine's own domain contexts, so the two can never drift apart.
 */

import type { ApprovalNonce } from "../generated/ApprovalNonce";
import type { ConfirmApproval } from "../generated/ConfirmApproval";
import type { CreateApproval } from "../generated/CreateApproval";
import type { Device } from "../generated/Device";
import type { DeviceList } from "../generated/DeviceList";
import type { PendingApproval } from "../generated/PendingApproval";

/** Sign-up between its two requests. */
export interface PendingRegistration {
  /** `RegisterStart.registration_request`. */
  readonly request: Uint8Array;
}

/** Sign-in between its two requests. */
export interface PendingLogin {
  /** `LoginStart.credential_request`. */
  readonly request: Uint8Array;
}

/** One device's keys. */
export interface DeviceKeys {
  /** The secret bytes for this device's key store (64 of them). */
  export(): Uint8Array;
  signingKey(): string;
  agreementKey(): string;
  sign(context: string, message: Uint8Array): Uint8Array;
  /** The `device_signature` of `RegisterFinish`. Normalises the email. */
  signRegistration(email: string, upload: Uint8Array): Uint8Array;
  /** The `device_signature` of `LoginFinish`, for the `login_id` from `LoginStarted`. */
  signLogin(loginId: string): Uint8Array;
  /** The `signature` of a `TrustedDeviceProof`; `signedAt` is Unix seconds. */
  signTrustedStart(email: string, credentialRequest: Uint8Array, signedAt: number): Uint8Array;
}

/**
 * An approval this trusted device started (steps 1, 3 and 4 of the two-way comparison). It works
 * once and lives only in memory: reloading the page ends it, and a new approval starts again.
 */
export interface ApproverPairing {
  /** The `CreateApproval` to send (step 1): only a commitment to this device's nonce. */
  readonly createRequest: CreateApproval;
  /** The new device's key fingerprint, shown next to the digits. */
  deviceFingerprint(): string;
  /** Step 3, given `GET /v1/devices/approvals/{id}` once the new device sent its nonce: the nonce to reveal. Throws if the server shows other keys than this started with. */
  reveal(view: PendingApproval): ApprovalNonce;
  /** The six digits, once revealed. */
  sas(): string | undefined;
}

/** An approval this new device joined (steps 2 and 5). It works once. */
export interface DevicePairing {
  /** The nonce to send (step 2). */
  readonly nonce: ApprovalNonce;
  /** The six digits, given `GET /v1/devices/current` once the approver revealed its nonce. Throws if that nonce does not match the commitment. */
  sas(view: PendingApproval): string;
}

/** The approval functions of the sync engine for one device (orbyn-wasm's `SyncEngine`). */
export interface ApprovalEngine {
  /** Step 1: starts approving a pending device. `nowSecs` is Unix seconds. */
  startApproval(device: Device, nowSecs: number): ApproverPairing;
  /** Step 4, only after the person tapped "They match" on this device: the body for `…/confirm`. Uses the session up. */
  confirmApproval(session: ApproverPairing, devices: DeviceList): ConfirmApproval;
  /** Step 2: joins the approval of `GET /v1/devices/current`. Throws if it is older than ten minutes. */
  joinApproval(view: PendingApproval, nowSecs: number): DevicePairing;
  /**
   * Step 5, only after the person confirmed on this device (`typed` is the approver's digits if the
   * person typed them). Throws until the approver has confirmed. Checks everything, trusts the
   * approver and the devices it endorsed, and returns the digits to send to `…/code`.
   */
  finishApproval(session: DevicePairing, view: PendingApproval, typed: string | undefined, nowSecs: number): string;
}

export interface AuthCrypto {
  startRegistration(password: Uint8Array): PendingRegistration;
  /** Returns `RegisterFinish.registration_upload`. Works once. */
  finishRegistration(pending: PendingRegistration, password: Uint8Array, response: Uint8Array): Uint8Array;
  startLogin(password: Uint8Array): PendingLogin;
  /** Returns `LoginFinish.credential_finalization`. A wrong password throws `auth_failed`. */
  finishLogin(pending: PendingLogin, password: Uint8Array, response: Uint8Array): Uint8Array;
  /** `DeviceKeys.create()` and `DeviceKeys.import(bytes)` in the module. */
  deviceKeys: {
    create(): DeviceKeys;
    import(bytes: Uint8Array): DeviceKeys;
  };
  /** `SyncEngine.create(keys, accountId, deviceId)` in the module, for its approval functions. */
  approvals(keys: DeviceKeys, accountId: string, deviceId: string): ApprovalEngine;
  /** Trims and lowercases an address; undefined when it is not one. */
  normalizeEmail(email: string): string | undefined;
}

/** True for the module's error for a wrong password. */
export function isAuthFailed(error: unknown): boolean {
  return error instanceof Error && /^auth_failed\b/.test(error.message);
}

let registered: AuthCrypto | null = null;

/** The real implementation registers itself here once its module is loaded. */
export function registerAuthCrypto(impl: AuthCrypto | null): void {
  registered = impl;
}

export const SIGN_IN_UNAVAILABLE = "Sign-in isn't available in this build yet";

export class SignInUnavailable extends Error {
  constructor() {
    super(SIGN_IN_UNAVAILABLE);
    this.name = "SignInUnavailable";
  }
}

export function authCryptoAvailable(): boolean {
  return registered !== null;
}

/** The registered implementation, or a refusal to go on: there is no fallback and no fake in a build. */
export function requireAuthCrypto(): AuthCrypto {
  if (!registered) throw new SignInUnavailable();
  return registered;
}
