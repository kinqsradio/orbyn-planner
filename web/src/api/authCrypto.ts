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
import type { RemoveDevice } from "../generated/RemoveDevice";

/** Sign-up between its two requests. */
export interface PendingRegistration {
  /** Releases the module's memory, after `finishRegistration`. */
  free?(): void;
  /** `RegisterStart.registration_request`. */
  readonly request: Uint8Array;
}

/** Sign-in between its two requests. */
export interface PendingLogin {
  /** Releases the module's memory, after `finishLogin`. */
  free?(): void;
  /** `LoginStart.credential_request`. */
  readonly request: Uint8Array;
}

/** One device's keys. */
export interface DeviceKeys {
  /** Releases the module's memory for these keys. Use after the last call; the keys can't be used again. */
  free(): void;
  /** The keys sealed under the wrapping secret, for this device's key store (see `wrapSecret.ts`). */
  export(wrapSecret: Uint8Array): Uint8Array;
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
  /** Releases the module's memory for this session, once it has ended. */
  free(): void;
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
  /** Releases the module's memory for this session, once it has ended. */
  free(): void;
  /** The nonce to send (step 2). */
  readonly nonce: ApprovalNonce;
  /** The six digits, given `GET /v1/devices/current` once the approver revealed its nonce. Throws if that nonce does not match the commitment. */
  sas(view: PendingApproval): string;
}

/**
 * The record side of the sync engine (orbyn-wasm's `SyncEngine`), with the module's own JSON strings in and
 * out: the planner's sync layer parses them where it uses them. The stand-in crypto doesn't have it; tests
 * of sync run the real module.
 */
export interface SyncApi {
  /** A `Stamp` for an edit at `now` (milliseconds). */
  tick(now: number): string;
  /** Stages already stamped `Fields` for a record. Throws `no_zone_key` while the zone has no key here. */
  stage(zone: string, recordType: string, recordId: string, fieldsJson: string): void;
  /** A signed delete of a record. */
  delete(zone: string, recordId: string): void;
  /** The next `UploadChanges`, or undefined when nothing is dirty. The same batch until its answer is applied. */
  buildUpload(zone: string): string | undefined;
  uploadSucceeded(zone: string, resultJson: string): void;
  /** Applies a 409 `RecordChanged`; returns `Applied`. */
  uploadConflicted(zone: string, conflictJson: string, now: number): string;
  abandonUpload(zone: string): void;
  /** Applies one `ZoneChanges` page; returns `Applied`. */
  applyChanges(zone: string, pageJson: string, now: number): string;
  /** The zone's change token for `?since=`. */
  token(zone: string): string | undefined;
  /** A live record's `Fields`. */
  record(zone: string, recordId: string): string | undefined;
  /** Compares one `ZoneList` page; returns `{stale, next}`. */
  checkZones(zonesJson: string): string;
  createZoneKey(zone: string): string;
  /** A `PutKeyEnvelopes` for every device of the `DeviceList` this device verifies. */
  envelopesFor(zone: string, devicesJson: string): string;
  /** Opens a `KeyEnvelopeList` from verified devices; returns `{zones, refused}`. */
  acceptEnvelopes(envelopesJson: string, devicesJson: string): string;
  retryQuarantined(zone: string, now: number): string;
  trash(zone: string): string;
  takeFromTrash(zone: string, recordId: string): string | undefined;
  deleteZoneProof(zone: string): string;
}

/** The approval functions of the sync engine for one device (orbyn-wasm's `SyncEngine`). */
export interface ApprovalEngine {
  /** The record side; present with the real module. */
  readonly sync?: SyncApi;
  /** Releases the module's memory for this engine. Its state must have been saved first. */
  free(): void;
  /** The engine's state sealed under the wrapping secret, for the key store. It holds who this device trusts and the removal sequence. */
  snapshot(wrapSecret: Uint8Array): Uint8Array;
  /**
   * The ids in the list this device verifies by approval chain: its own view of who is trusted,
   * never the server's `state`. Also counts the list's removals, so the next one is signed with a
   * sequence above them.
   */
  verifyDevices(devices: DeviceList): string[];
  /** The `DELETE /v1/devices/{id}` body that removes a device: a sequence one above every removal this device has counted, and the signature over it. */
  signRemoval(device: Device): RemoveDevice;
  /**
   * Step 1: starts approving a device this device does not verify: a pending one, or one the server
   * lists as trusted that this device no longer trusts (stranded by a removal, say) and approves
   * again. Throws for a device this device pins. `nowSecs` is Unix seconds.
   */
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
  /** `DeviceKeys.create()` and `DeviceKeys.import(sealed, wrapSecret)` in the module. */
  deviceKeys: {
    create(): DeviceKeys;
    import(sealed: Uint8Array, wrapSecret: Uint8Array): DeviceKeys;
  };
  /** `SyncEngine.create(keys, accountId, deviceId)` and `SyncEngine.restore(keys, sealed, wrapSecret, nowMillis)`. */
  engine: {
    /** A device with no snapshot yet: it trusts only itself, and its approver once approved. */
    create(keys: DeviceKeys, accountId: string, deviceId: string): ApprovalEngine;
    /** From a snapshot sealed under the same wrapping secret. Throws if it was sealed otherwise or changed. */
    restore(keys: DeviceKeys, sealed: Uint8Array, wrapSecret: Uint8Array, nowMillis: number): ApprovalEngine;
  };
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
