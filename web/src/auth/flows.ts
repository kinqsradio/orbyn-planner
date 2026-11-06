import { ApiFailure } from "../api/auth";
import { AuthCryptoError, type DeviceKeys } from "../api/authCrypto";
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
} from "../api/authMessages";
import { decodeBytes, encodeBytes } from "../api/bytes";
import type { StoredSession } from "../api/keyStore";
import type { ApprovalCreated } from "../generated/ApprovalCreated";
import type { Device } from "../generated/Device";
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
  return { name: deviceName(), platform: "web", signing_key: encodeBytes(keys.signing), agreement_key: encodeBytes(keys.agreement) };
}

/** A failure the person can read, from anything these flows throw. */
function asFailure(error: unknown): never {
  if (error instanceof AuthCryptoError) {
    if (error.kind === "login_failed") throw new ApiFailure("login_failed", 401, "That email and password don’t match.");
    throw new ApiFailure("invalid_request", 0, "Something went wrong with the sign-in. Try again.");
  }
  throw error;
}

function emailOrFail(email: string): string {
  const normal = normalizeEmail(email);
  if (!normal) throw new ApiFailure("invalid_email", 400, "Enter a valid email address.");
  return normal;
}

/** Creates the account and signs this device in as its first, trusted device. */
export async function signUp(services: AuthServices, input: { name: string; email: string; password: string }): Promise<StoredSession> {
  const email = emailOrFail(input.email);
  const crypto = services.crypto(); // refuses before anything is sent when sign-in is not in this build
  try {
    const { state, request } = await crypto.startRegistration(input.password);
    const started = await services.api.registerStart({ email, registration_request: encodeBytes(request) });
    const { upload } = await crypto.finishRegistration(state, input.password, decodeBytes(started.registration_response));
    const keys = await crypto.createDeviceKeys();
    const signature = await crypto.sign(keys, DEVICE_REGISTER_CONTEXT, registerMessage(email, upload, keys));
    const created = await services.api.registerFinish({
      email,
      registration_upload: encodeBytes(upload),
      device: describeDevice(keys),
      device_signature: encodeBytes(signature),
    });
    await services.keys.saveKeys(await crypto.exportDeviceKeys(keys));
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
  const email = emailOrFail(input.email);
  const crypto = services.crypto();
  try {
    const saved = await services.keys.loadKeys();
    const known = saved ? await crypto.importDeviceKeys(saved) : null;
    const { state, request } = await crypto.startLogin(input.password);

    let trusted: { signing_key: string; signed_at: bigint; signature: string } | undefined;
    if (known) {
      const signedAt = Math.floor(services.now() / 1000);
      const signature = await crypto.sign(known, TRUSTED_START_CONTEXT, trustedStartMessage(email, request, signedAt));
      trusted = { signing_key: encodeBytes(known.signing), signed_at: BigInt(signedAt), signature: encodeBytes(signature) };
    }
    const started = await services.api.loginStart({ email, credential_request: encodeBytes(request), trusted_device: trusted });
    // A wrong password fails here, on the device, and nothing more is sent.
    const { finalization } = await crypto.finishLogin(state, input.password, decodeBytes(started.credential_response));

    const keys = known ?? (await crypto.createDeviceKeys());
    const signature = await crypto.sign(keys, DEVICE_LOGIN_CONTEXT, loginMessage(started.login_id, keys));
    const created = await services.api.loginFinish({
      login_id: started.login_id,
      credential_finalization: encodeBytes(finalization),
      device: describeDevice(keys),
      device_signature: encodeBytes(signature),
    });
    if (!known) await services.keys.saveKeys(await crypto.exportDeviceKeys(keys));
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

/** Approves a pending device from a trusted one: signs its id and keys, and gets the six-digit code to show. */
export async function approveDevice(services: AuthServices, session: StoredSession, pending: Device): Promise<ApprovalCreated> {
  const saved = await services.keys.loadKeys();
  if (!saved) throw new ApiFailure("device_not_trusted", 403, "This device has no keys, so it can’t approve another.");
  const crypto = services.crypto();
  const mine = await crypto.importDeviceKeys(saved);
  const message = approvalMessage(session.accountId, pending.id, { signing: decodeBytes(pending.signing_key), agreement: decodeBytes(pending.agreement_key) });
  const signature = await crypto.sign(mine, DEVICE_APPROVAL_CONTEXT, message);
  return services.api.createApproval({ device_id: pending.id, signature: encodeBytes(signature) });
}

/** The pending device types the code; on success this device is trusted. */
export async function submitApprovalCode(services: AuthServices, approvalId: string, code: string): Promise<Device> {
  const device = await services.api.submitCode(approvalId, { code: code.replace(/\s+/g, "") });
  await services.tokens.update({ deviceState: device.state });
  return device;
}
