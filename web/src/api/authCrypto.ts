/**
 * The OPAQUE password protocol and the device keys (Ed25519 for signing, X25519 for agreement),
 * shaped to match the engine's WebAssembly module, orbyn-wasm, name for name (its README has the
 * table). Passwords and messages go in and out as bytes, public keys as base64url, and a failure
 * throws an `Error` whose message starts with a stable code, such as `auth_failed: ...` for a wrong
 * password. The planner builds and signs no protocol message itself: the module does, under the
 * engine's own domain contexts, so the two can never drift apart.
 */

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
  /** The `signature` of `CreateApproval` for a pending device and its keys. */
  signApproval(accountId: string, deviceId: string, signingKey: string, agreementKey: string): Uint8Array;
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
