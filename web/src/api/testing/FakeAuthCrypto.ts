import type { AuthCrypto, DeviceKeys, PendingLogin, PendingRegistration } from "../authCrypto";
import { concat, encodeBytes, utf8 } from "../bytes";
import {
  DEVICE_APPROVAL_CONTEXT,
  DEVICE_LOGIN_CONTEXT,
  DEVICE_REGISTER_CONTEXT,
  TRUSTED_START_CONTEXT,
  approvalMessage,
  loginMessage,
  normalizeEmail,
  registerMessage,
  trustedStartMessage,
} from "./authMessages";
import { decodeBytes } from "../bytes";

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

const passwordTag = (password: Uint8Array) => digest(utf8("pw"), password);

export function fakeSignature(signing: Uint8Array, context: string, message: Uint8Array): Uint8Array {
  const half = digest(signing, utf8(context), message);
  return concat(half, digest(half, signing));
}

export function fakeVerify(signing: Uint8Array, context: string, message: Uint8Array, signature: Uint8Array): boolean {
  const want = fakeSignature(signing, context, message);
  return signature.length === 64 && want.every((b, i) => b === signature[i]);
}

/** What the mock server stores for a password, and checks at sign-in. */
export const fakeVerifierFor = (password: string) => passwordTag(utf8(password));

let counter = 0;

class FakeDeviceKeys implements DeviceKeys {
  constructor(private readonly signing: Uint8Array, private readonly agreement: Uint8Array) {}

  export() {
    return concat(this.signing, this.agreement);
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
  signTrustedStart(email: string, credentialRequest: Uint8Array, signedAt: number) {
    const normal = normalizeEmail(email);
    if (!normal) throw new Error("invalid_email: not an email");
    return this.sign(TRUSTED_START_CONTEXT, trustedStartMessage(normal, credentialRequest, signedAt));
  }
  signApproval(accountId: string, deviceId: string, signingKey: string, agreementKey: string) {
    return this.sign(DEVICE_APPROVAL_CONTEXT, approvalMessage(accountId, deviceId, { signing: decodeBytes(signingKey), agreement: decodeBytes(agreementKey) }));
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
      return new FakeDeviceKeys(digest(utf8("signing"), utf8(String(n)), utf8(String(Math.random()))), digest(utf8("agreement"), utf8(String(n)), utf8(String(Math.random()))));
    },
    import: (bytes: Uint8Array): DeviceKeys => new FakeDeviceKeys(bytes.slice(0, 32), bytes.slice(32, 64)),
  };

  normalizeEmail(email: string) {
    return normalizeEmail(email) ?? undefined;
  }
}
