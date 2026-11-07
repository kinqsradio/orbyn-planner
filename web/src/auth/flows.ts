import { ApiFailure } from "../api/auth";
import { isAuthFailed, type AuthCrypto, type DeviceKeys } from "../api/authCrypto";
import { decodeBytes, encodeBytes, utf8 } from "../api/bytes";
import type { StoredSession } from "../api/keyStore";
import type { Device } from "../generated/Device";
import type { DeviceList } from "../generated/DeviceList";
import type { NewDevice } from "../generated/NewDevice";
import type { SecondFactorLogin } from "../generated/SecondFactorLogin";
import type { SecondFactorRequired } from "../generated/SecondFactorRequired";
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

/**
 * The password was right but the account has two-factor on: the engine issued no session and asked for a code. This holds the
 * sign-in open (the device's keys stay in memory, nothing is stored) until `complete` gets a code or a recovery code that works,
 * or `cancel` lets it go. A wrong code throws the engine's `second_factor_failed` and leaves the sign-in open to try again; the
 * engine closes it after five (then `complete` throws `login_failed` and the keys are released).
 */
export class SecondFactorNeeded extends Error {
  constructor(
    readonly complete: (factor: { code?: string; recoveryCode?: string }) => Promise<StoredSession>,
    readonly cancel: () => void,
  ) {
    super("Enter the code from your authenticator app to finish signing in.");
    this.name = "SecondFactorNeeded";
  }
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
  let keys: DeviceKeys | null = null;
  try {
    const email = emailOrFail(crypto, input.email);
    const password = utf8(input.password);
    const pending = crypto.startRegistration(password);
    const started = await services.api.registerStart({ email, registration_request: encodeBytes(pending.request) });
    let upload: Uint8Array;
    try {
      upload = crypto.finishRegistration(pending, password, decodeBytes(started.registration_response));
    } finally {
      pending.free?.();
    }
    keys = crypto.deviceKeys.create();
    const created = await services.api.registerFinish({
      email,
      registration_upload: encodeBytes(upload),
      device: describeDevice(keys),
      device_signature: encodeBytes(keys.signRegistration(email, upload)),
    });
    const wrap = await services.wrapSecret();
    try {
      await services.keys.saveKeys(keys.export(wrap));
    } finally {
      wrap.fill(0);
    }
    await services.keys.saveIdentity({ accountId: created.account_id, deviceId: created.device_id, email });
    const session = toStored(created, email, input.name.trim());
    await services.tokens.set(session);
    return session;
  } catch (error) {
    return asFailure(error);
  } finally {
    keys?.free();
  }
}

/** This browser holds the keys of another account. Signing in to this one would remove them, so the person must agree first. */
export class KeysForAnotherAccount extends Error {
  constructor(
    /** The other account's email with most of it hidden, or null if none was recorded. */
    readonly maskedEmail: string | null,
  ) {
    super(
      maskedEmail
        ? `This browser holds the keys for another Orbyn account (${maskedEmail}). Signing in to a different account removes them from this browser.`
        : "This browser holds the keys for another Orbyn account. Signing in to a different account removes them from this browser.",
    );
    this.name = "KeysForAnotherAccount";
  }
}

/** "sam@example.com" as "s•••@e•••.com": a personal domain would name the owner on a shared browser. */
export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at < 1) return "•••";
  const domain = email.slice(at + 1);
  const dot = domain.lastIndexOf(".");
  const host = dot > 0 ? domain.slice(0, dot) : domain;
  const tld = dot > 0 ? domain.slice(dot) : "";
  return `${email[0]}•••@${host[0] ?? ""}•••${tld}`;
}

/**
 * Signs in. A browser that already holds trusted keys proves it with a signature, so someone
 * guessing passwords cannot use up the owner's attempts. A new browser signs in as a pending device.
 *
 * Keys belong to one account. If the stored keys were made for another email, nothing is sent until
 * the person agrees (`replaceKeys`): then this attempt uses new keys held only in memory, with no
 * proof from the old ones, so the server can't link the two accounts. The stored keys, snapshot and
 * wrapping key are not touched unless the sign-in succeeds; only then are they replaced. A mistyped
 * email or password therefore never costs a trusted device its keys.
 */
export async function signIn(services: AuthServices, input: { email: string; password: string; name?: string; replaceKeys?: boolean }): Promise<StoredSession> {
  const crypto = services.crypto();
  let keys: DeviceKeys | null = null;
  let known = null as DeviceKeys | null;
  /** True while a code step holds this attempt's keys: they are released when it finishes or is cancelled. */
  let holding = false;
  try {
    const email = emailOrFail(crypto, input.email);
    const password = utf8(input.password);
    const saved = await services.keys.loadKeys();
    const identity = saved ? await services.keys.loadIdentity() : null;
    const foreign = saved !== null && identity?.email !== email;
    if (foreign && !input.replaceKeys) throw new KeysForAnotherAccount(identity?.email ? maskEmail(identity.email) : null);
    if (saved && !foreign) {
      const wrap = await services.wrapSecret();
      try {
        known = crypto.deviceKeys.import(saved, wrap);
      } finally {
        wrap.fill(0);
      }
    }
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
    let finalization: Uint8Array;
    try {
      finalization = crypto.finishLogin(pending, password, decodeBytes(started.credential_response));
    } finally {
      pending.free?.(); // also after a wrong password: the module's memory goes back whatever happened
    }

    keys = known ?? crypto.deviceKeys.create();
    let created: SessionCreated;
    try {
      created = await services.api.loginFinish({
        login_id: started.login_id,
        credential_finalization: encodeBytes(finalization),
        device: describeDevice(keys),
        device_signature: encodeBytes(keys.signLogin(started.login_id)),
      });
    } catch (e) {
      if (!(e instanceof ApiFailure && e.code === "second_factor_required")) throw e;
      // Two-factor is on: no session yet. The keys stay in memory for the code step, and the finally below must not release them.
      const held = keys;
      holding = true;
      const loginId = (e.body as Partial<SecondFactorRequired> | null)?.login_id ?? started.login_id;
      const wasKnown = known !== null;
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        held.free();
      };
      throw new SecondFactorNeeded(async (factor) => {
        const body: SecondFactorLogin = { login_id: loginId, code: factor.code ?? null, recovery_code: factor.recoveryCode ?? null };
        try {
          const done = await services.api.loginSecondFactor(body);
          await bindKeys(services, held, wasKnown, done, email, foreign);
          const session = toStored(done, email, input.name ?? "");
          await services.tokens.set(session);
          release();
          return session;
        } catch (err) {
          // A wrong code leaves the sign-in open for another try; anything else ends it.
          if (!(err instanceof ApiFailure && err.code === "second_factor_failed")) release();
          throw err;
        }
      }, release);
    }
    await bindKeys(services, keys, known !== null, created, email, foreign);
    const session = toStored(created, email, input.name ?? "");
    await services.tokens.set(session);
    return session;
  } catch (error) {
    return asFailure(error);
  } finally {
    // Whichever keys this attempt held (the saved ones opened, or new ones), they go back to the module.
    if (!holding) (keys ?? known)?.free();
  }
}

/**
 * Ties the stored keys and the engine's saved state to the account and device this sign-in gave. New
 * keys are stored. Keys made for another account are replaced, with the old state wiped; the same
 * account under a new device id means the old row was removed, so the saved trust state is wiped.
 */
async function bindKeys(services: AuthServices, keys: DeviceKeys, existing: boolean, created: SessionCreated, email: string, replaceKeys: boolean): Promise<void> {
  // Under the engine's lock, so no action in another tab is half-way through saving into what is wiped here.
  await services.engine.exclusive(async () => {
    const identity = await services.keys.loadIdentity();
    const seal = async () => {
      const wrap = await services.wrapSecret();
      try {
        await services.keys.saveKeys(keys.export(wrap));
      } finally {
        wrap.fill(0);
      }
    };
    /** Other keys for this device: the old state goes and the new keys and identity arrive in one transaction. */
    const replace = async () => {
      const fresh = await services.freshWrap();
      try {
        await services.keys.replaceDevice({ keys: keys.export(fresh.secret), wrapKey: fresh.key, identity: { accountId: created.account_id, deviceId: created.device_id, email } });
      } finally {
        fresh.secret.fill(0);
      }
    };
    if (replaceKeys) {
      // The person agreed to give up the other account's keys, and this sign-in worked: only now.
      await replace();
      return;
    }
    if (!existing) {
      await services.keys.clearSnapshot(); // no keys were here: whatever snapshot there is is not theirs
      await seal();
    } else if (identity && identity.accountId !== created.account_id) {
      await replace();
      return;
    } else if (!identity || identity.deviceId !== created.device_id) {
      await services.keys.clearSnapshot();
    }
    await services.keys.saveIdentity({ accountId: created.account_id, deviceId: created.device_id, email });
  });
}

/**
 * Signs this device out. The session is forgotten here even if the server cannot be reached, and the
 * other tabs are told. Then the device is forgotten too: its keys, the engine's saved state (bound to
 * them) and the wrapping key go together. If that fails, the person is told.
 */
export async function signOut(services: AuthServices): Promise<void> {
  try {
    await services.api.signOut();
  } catch {
    // Already over, or unreachable: either way this device forgets it.
  }
  await services.tokens.clear();
  services.signedOut.post();
  try {
    await services.engine.forget();
  } catch {
    throw new ApiFailure("forget_failed", 0, "You’re signed out, but this device’s saved keys couldn’t be removed. Clear this site’s data to be sure.");
  }
}

/**
 * Removes a device. The engine asks for this device's signature over the account, the device, its
 * keys and a removal sequence one above every removal this device has counted. The count lives in
 * the engine's saved state, so it only goes up; the list is counted first, and again afterwards so
 * this removal is counted before the next.
 */
export async function removeDevice(services: AuthServices, session: StoredSession, device: Device): Promise<void> {
  const list = await services.api.devices();
  const body = await services.engine.run(session, (engine) => {
    engine.verifyDevices(list);
    return engine.signRemoval(device);
  });
  await services.api.removeDevice(device.id, body);
  try {
    const after = await services.api.devices();
    await services.engine.run(session, (engine) => void engine.verifyDevices(after));
  } catch {
    // The removal is done; the next one counts it from the list.
  }
}

/** The ids of the devices this device itself verifies (never the server's word), or null if it can't tell. */
export async function verifiedDevices(services: AuthServices, session: StoredSession, list: DeviceList): Promise<Set<string> | null> {
  try {
    return new Set(await services.engine.run(session, (engine) => engine.verifyDevices(list)));
  } catch {
    return null;
  }
}
