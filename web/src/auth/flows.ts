import { ApiFailure } from "../api/auth";
import { isAuthFailed, type AuthCrypto, type DeviceKeys } from "../api/authCrypto";
import { decodeBytes, encodeBytes, utf8 } from "../api/bytes";
import type { StoredSession } from "../api/keyStore";
import type { NewDevice } from "../generated/NewDevice";
import type { SessionCreated } from "../generated/SessionCreated";
import { deviceName } from "./deviceName";
import type { AuthServices } from "./services";

const toStored = (s: SessionCreated, email: string, name: string): StoredSession => ({
  token: s.token,
  accountId: s.account_id,
  deviceId: s.device_id,
  deviceState: s.device_state,
  expiresAt: s.expires_at,
  email,
  name,
});

function describeDevice(keys: DeviceKeys): NewDevice {
  return { name: deviceName(), platform: "web", signing_key: keys.signingKey(), agreement_key: keys.agreementKey() };
}

/** A failure the person can read, from anything these flows throw. */
function asFailure(error: unknown): never {
  if (isAuthFailed(error)) throw new ApiFailure("login_failed", 401, "That email and password don’t match.");
  if (error instanceof Error && /^(invalid_message|invalid_email|already_finished|failed):/.test(error.message)) {
    throw new ApiFailure("invalid_request", 0, "Something went wrong with the sign-in. Try again.");
  }
  throw error;
}

function emailOrFail(crypto: AuthCrypto, email: string): string {
  const normal = crypto.normalizeEmail(email);
  if (!normal) throw new ApiFailure("invalid_email", 400, "Enter a valid email address.");
  return normal;
}

/** Creates the account and signs this device in as its first, trusted device. */
export async function signUp(services: AuthServices, input: { name: string; email: string; password: string }): Promise<StoredSession> {
  const crypto = services.crypto(); // refuses before anything is sent when sign-in is not in this build
  try {
    const email = emailOrFail(crypto, input.email);
    const password = utf8(input.password);
    const pending = crypto.startRegistration(password);
    const started = await services.api.registerStart({ email, registration_request: encodeBytes(pending.request) });
    const upload = crypto.finishRegistration(pending, password, decodeBytes(started.registration_response));
    const keys = crypto.deviceKeys.create();
    const created = await services.api.registerFinish({
      email,
      registration_upload: encodeBytes(upload),
      device: describeDevice(keys),
      device_signature: encodeBytes(keys.signRegistration(email, upload)),
    });
    await services.keys.saveKeys(keys.export());
    const session = toStored(created, email, input.name.trim());
    await services.tokens.set(session);
    return session;
  } catch (error) {
    return asFailure(error);
  }
}

/**
 * Signs in. A browser that already holds trusted keys proves it with a signature, so someone
 * guessing passwords cannot use up the owner's attempts. A new browser signs in as a pending device.
 */
export async function signIn(services: AuthServices, input: { email: string; password: string; name?: string }): Promise<StoredSession> {
  const crypto = services.crypto();
  try {
    const email = emailOrFail(crypto, input.email);
    const password = utf8(input.password);
    const saved = await services.keys.loadKeys();
    const known = saved ? crypto.deviceKeys.import(saved) : null;
    const pending = crypto.startLogin(password);

    let trusted: { signing_key: string; signed_at: bigint; signature: string } | undefined;
    if (known) {
      const signedAt = Math.floor(services.now() / 1000);
      trusted = {
        signing_key: known.signingKey(),
        signed_at: BigInt(signedAt),
        signature: encodeBytes(known.signTrustedStart(email, pending.request, signedAt)),
      };
    }
    const started = await services.api.loginStart({ email, credential_request: encodeBytes(pending.request), trusted_device: trusted });
    // A wrong password fails here, on the device, and nothing more is sent.
    const finalization = crypto.finishLogin(pending, password, decodeBytes(started.credential_response));

    const keys = known ?? crypto.deviceKeys.create();
    const created = await services.api.loginFinish({
      login_id: started.login_id,
      credential_finalization: encodeBytes(finalization),
      device: describeDevice(keys),
      device_signature: encodeBytes(keys.signLogin(started.login_id)),
    });
    if (!known) await services.keys.saveKeys(keys.export());
    const session = toStored(created, email, input.name ?? "");
    await services.tokens.set(session);
    return session;
  } catch (error) {
    return asFailure(error);
  }
}

/** Signs this device out. The session is forgotten here even if the server cannot be reached. */
export async function signOut(services: AuthServices): Promise<void> {
  try {
    await services.api.signOut();
  } catch {
    // Already over, or unreachable: either way this device forgets it.
  }
  await services.tokens.clear();
}
