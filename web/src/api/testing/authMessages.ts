import { concat, utf8, uuidBytes } from "../bytes";

/**
 * The messages devices sign, byte for byte as orbyn-auth-client builds them (a port of
 * `register_message`, `login_message`, `trusted_start_message` and `approval_message`), and the
 * domain contexts they are signed under. Keep them in step with the engine.
 */
export const DEVICE_REGISTER_CONTEXT = "orbyn/device-register/v1";
export const DEVICE_LOGIN_CONTEXT = "orbyn/device-login/v1";
export const DEVICE_APPROVAL_CONTEXT = "orbyn/device-approval/v1";
export const TRUSTED_START_CONTEXT = "orbyn/trusted-login-start/v1";

/** A device's two public keys, 32 bytes each. */
export interface DevicePublic {
  signing: Uint8Array;
  agreement: Uint8Array;
}

/** Trims and lowercases an address; null when it is not one. The same rules as the engine's `normalize_email`. */
export function normalizeEmail(email: string): string | null {
  const text = email.trim().toLowerCase();
  if (text === "" || utf8(text).length > 254) return null;
  const at = text.indexOf("@");
  if (at < 0) return null;
  const local = text.slice(0, at);
  const domain = text.slice(at + 1);
  const valid =
    local !== "" &&
    utf8(local).length <= 64 &&
    domain !== "" &&
    !domain.includes("@") &&
    !domain.startsWith(".") &&
    !domain.endsWith(".") &&
    // eslint-disable-next-line no-control-regex
    !/[\s\u0000-\u001f\u007f-\u009f]/u.test(text);
  return valid ? text : null;
}

/** A length as 8 bytes, big endian. */
function u64(n: number): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, BigInt(n), false);
  return out;
}

const prefixed = (bytes: Uint8Array) => concat(u64(bytes.length), bytes);
const device = (keys: DevicePublic) => concat(keys.signing, keys.agreement);

/** What the first device signs at sign-up: the email, the registration upload and its own keys. */
export function registerMessage(email: string, upload: Uint8Array, keys: DevicePublic): Uint8Array {
  return concat(prefixed(utf8(email)), prefixed(upload), device(keys));
}

/** What a device signs at sign-in: the login id the server gave it and its own keys. */
export function loginMessage(loginId: string, keys: DevicePublic): Uint8Array {
  return concat(uuidBytes(loginId), device(keys));
}

/** What an already trusted device signs when it starts a sign-in: the email, the credential request and the time in seconds. */
export function trustedStartMessage(email: string, credentialRequest: Uint8Array, signedAt: number): Uint8Array {
  const time = new Uint8Array(8);
  new DataView(time.buffer).setBigInt64(0, BigInt(signedAt), false);
  return concat(prefixed(utf8(email)), prefixed(credentialRequest), time);
}

/** What a trusted device signs to approve a pending one: the account, the pending device's id and its keys. */
export function approvalMessage(accountId: string, deviceId: string, keys: DevicePublic): Uint8Array {
  return concat(uuidBytes(accountId), uuidBytes(deviceId), device(keys));
}
