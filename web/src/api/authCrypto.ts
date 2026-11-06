import type { DevicePublic } from "./authMessages";

/** A device's keys: the public halves go to the server, `secret` is whatever the implementation needs to sign. */
export interface DeviceKeys extends DevicePublic {
  readonly secret: unknown;
}

/** Raised by an implementation when a step fails. `login_failed` is a wrong password. */
export class AuthCryptoError extends Error {
  constructor(readonly kind: "login_failed" | "invalid_message" | "failed", message?: string) {
    super(message ?? kind);
    this.name = "AuthCryptoError";
  }
}

/**
 * The OPAQUE password protocol and the device keys (Ed25519 for signing, X25519 for agreement). The
 * engine's WebAssembly module, orbyn-wasm, will implement this; the planner only calls it. The
 * password never leaves it except as OPAQUE messages. The signing context is the domain separation
 * string (see authMessages.ts), which the implementation applies when it signs.
 */
export interface AuthCrypto {
  /** Starts sign-up. `request` is sent as `registration_request`; `state` comes back to `finishRegistration`. */
  startRegistration(password: string): Promise<{ state: unknown; request: Uint8Array }>;
  /** Finishes sign-up with the server's `registration_response`. `upload` is sent as `registration_upload`. */
  finishRegistration(state: unknown, password: string, response: Uint8Array): Promise<{ upload: Uint8Array }>;
  startLogin(password: string): Promise<{ state: unknown; request: Uint8Array }>;
  /** Throws `AuthCryptoError("login_failed")` for a wrong password, before anything is sent. */
  finishLogin(state: unknown, password: string, response: Uint8Array): Promise<{ finalization: Uint8Array }>;

  createDeviceKeys(): Promise<DeviceKeys>;
  /** The bytes to keep on this device; non-extractable keys are not possible with every implementation. */
  exportDeviceKeys(keys: DeviceKeys): Promise<Uint8Array>;
  importDeviceKeys(bytes: Uint8Array): Promise<DeviceKeys>;
  sign(keys: DeviceKeys, context: string, message: Uint8Array): Promise<Uint8Array>;
}

let registered: AuthCrypto | null = null;

/** The real implementation registers itself here when its module is loaded. */
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
