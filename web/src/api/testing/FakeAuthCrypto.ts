import { AuthCryptoError, type AuthCrypto, type DeviceKeys } from "../authCrypto";
import { concat, utf8 } from "../bytes";

/**
 * A stand-in for the real OPAQUE and Ed25519 code, for tests ONLY. It is not secure and must never
 * be imported by anything that is built into the app; a test checks that and checks the build.
 */
export const FAKE_AUTH_MARKER = "orbyn-fake-auth-crypto-DO-NOT-SHIP";

/** A 32-byte tag of some parts, enough for a mock server to tell a right answer from a wrong one. */
function digest(...parts: Uint8Array[]): Uint8Array {
  const input = concat(...parts);
  const out = new Uint8Array(32);
  let h = 2166136261;
  for (let round = 0; round < 32; round++) {
    for (const b of input) h = Math.imul(h ^ b ^ round, 16777619) >>> 0;
    out[round] = h & 0xff;
  }
  return out;
}

const passwordTag = (password: string) => digest(utf8("pw"), utf8(password));

export function fakeSignature(signing: Uint8Array, context: string, message: Uint8Array): Uint8Array {
  const half = digest(signing, utf8(context), message);
  return concat(half, digest(half, signing));
}

export function fakeVerify(signing: Uint8Array, context: string, message: Uint8Array, signature: Uint8Array): boolean {
  const want = fakeSignature(signing, context, message);
  return signature.length === 64 && want.every((b, i) => b === signature[i]);
}

/** What the mock server stores for a password, and checks at sign-in. */
export const fakeVerifierFor = (password: string) => passwordTag(password);

let counter = 0;

export class FakeAuthCrypto implements AuthCrypto {
  readonly marker = FAKE_AUTH_MARKER;

  async startRegistration(password: string) {
    return { state: { password }, request: utf8("fake-registration-request") };
  }

  async finishRegistration(state: unknown, password: string, response: Uint8Array) {
    if (new TextDecoder().decode(response) !== "fake-registration-response") throw new AuthCryptoError("invalid_message");
    void state;
    return { upload: concat(utf8("fake-upload:"), passwordTag(password)) };
  }

  async startLogin(password: string) {
    return { state: { password }, request: utf8("fake-login-request") };
  }

  async finishLogin(state: unknown, password: string, response: Uint8Array) {
    // The server's response carries the verifier; a wrong password does not match, on the device.
    const verifier = response.slice("fake-login-response:".length);
    if (!passwordTag(password).every((b, i) => b === verifier[i])) throw new AuthCryptoError("login_failed");
    void state;
    return { finalization: utf8("fake-login-finalization") };
  }

  async createDeviceKeys(): Promise<DeviceKeys> {
    const n = ++counter;
    const signing = digest(utf8("signing"), utf8(String(n)), utf8(String(Math.random())));
    const agreement = digest(utf8("agreement"), utf8(String(n)), utf8(String(Math.random())));
    return { signing, agreement, secret: null };
  }

  async exportDeviceKeys(keys: DeviceKeys) {
    return concat(keys.signing, keys.agreement);
  }

  async importDeviceKeys(bytes: Uint8Array): Promise<DeviceKeys> {
    return { signing: bytes.slice(0, 32), agreement: bytes.slice(32, 64), secret: null };
  }

  async sign(keys: DeviceKeys, context: string, message: Uint8Array) {
    return fakeSignature(keys.signing, context, message);
  }
}
