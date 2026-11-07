import type { ApprovalNonce } from "../../generated/ApprovalNonce";
import type { ConfirmApproval } from "../../generated/ConfirmApproval";
import type { CreateApproval } from "../../generated/CreateApproval";
import type { ProtectionLink } from "../../generated/ProtectionLink";
import type { PendingApproval } from "../../generated/PendingApproval";
import type { Device } from "../../generated/Device";
import type { LoginFinish } from "../../generated/LoginFinish";
import type { LoginStart } from "../../generated/LoginStart";
import type { RegisterFinish } from "../../generated/RegisterFinish";
import type { RegisterStart } from "../../generated/RegisterStart";
import { decodeBytes, encodeBytes, utf8 } from "../bytes";
import { PROTECTION_CONTEXT, PROTECTION_GENESIS, protectionHash, protectionMessage } from "./protectionFake";
import {
  DEVICE_LOGIN_CONTEXT,
  DEVICE_REGISTER_CONTEXT,
  TOTP_MANAGE_CONTEXT,
  totpManageMessage,
  TRUSTED_START_CONTEXT,
  loginMessage,
  normalizeEmail,
  registerMessage,
  trustedStartMessage,
} from "./authMessages";
import { fakeVerify } from "./FakeAuthCrypto";
import { newMockRecords, recordStoreRoute, type MockRecords } from "./MockRecordStore";
import { fakeCommitment, fakeSas, pairingBytes, partsOfView } from "./fakePairing";

/** A recorded request, for tests to look at. */
export interface Call {
  method: string;
  path: string;
  body: unknown;
  authorization: string | null;
}

interface Account {
  id: string;
  email: string;
  verifier: Uint8Array;
  devices: Device[];
  removals?: Removal[];
  records?: MockRecords;
  /** Two-factor, as the engine keeps it: a pending or enabled secret and the unused recovery codes. */
  totp?: { enabled: boolean; recovery: string[] };
  /** The signed protection settings, oldest first. */
  protection?: ProtectionLink[];
  /** A server that serves the chain from sequence 1 whatever `?from=` asks (how an old chain is shown again). */
  protectionFromStart?: boolean;
}
/** The mock's one-time code: any other six digits are wrong. Recovery codes are `RECOV-0000N`. */
export const MOCK_TOTP_CODE = "123456";
export const MOCK_TOTP_SECRET = "JBSWY3DPEHPK3PXP";
interface Removal {
  device_id: string;
  signing_key: string;
  agreement_key: string;
  removed_by: string;
  sequence: number;
  signature: string;
}
/** An approval as the server holds it: the fields each step adds, in order. */
interface Approval {
  id: string;
  accountId: string;
  approverId: string;
  deviceId: string;
  createdAt: number;
  expiresAt: number;
  commitment: string;
  deviceNonce: string | null;
  approverNonce: string | null;
  signature: string | null;
  endorsement: string | null;
  closed: boolean;
}

let ids = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`;

/**
 * An in-memory stand-in for the engine's account routes, behind a `fetch`, for tests. It checks the
 * signatures the way the engine does (with the fake crypto's verifier), so a client that signs the
 * wrong message fails here as it would for real.
 */
export function createMockEngine(now: () => number = () => Date.now()) {
  const accounts = new Map<string, Account>();
  const sessions = new Map<string, { accountId: string; deviceId: string }>();
  const approvals = new Map<string, Approval>();
  const logins = new Map<string, { email: string; trusted: boolean }>();
  /** Sign-ins waiting for their second factor, with the wrong codes so far (five close one). */
  const waiting = new Map<string, { email: string; device: LoginFinish["device"]; wrong: number }>();
  const calls: Call[] = [];
  /** Sign-ups waiting for their email code, and the code each was last sent (the mock has no mailbox: tests read it here). */
  const signups = new Map<string, { email: string; upload: Uint8Array; device: RegisterFinish["device"]; code: string; wrong: number; sentAt: number; resends: number }>();
  let codeCounter = 100000;
  const nextCode = () => String(codeCounter++);
  const subscribers = new Set<(accountId: string, zone: string, token: string, author: string) => void>();
  /** Refuse the next calls to a path (or a path prefix) with this error: `refuseNext("/v1/sessions/login/start", 429, "too_many_attempts")`. */
  const refusals: { path: string; status: number; code: string; message: string; times: number }[] = [];
  const state = { attemptsPerEmail: new Map<string, number>(), trustedProofs: 0, lastManage: new Map<string, number>() };

  const json = (status: number, body: unknown) => new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const fail = (status: number, code: string, message: string) => json(status, { code, message });
  const expiry = () => new Date(now() + 30 * 86_400_000).toISOString();

  function session(token: string | null) {
    const s = token ? sessions.get(token) : undefined;
    if (!s) return null;
    const account = [...accounts.values()].find((a) => a.id === s.accountId);
    const device = account?.devices.find((d) => d.id === s.deviceId);
    return account && device ? { account, device } : null;
  }

  /** The device of a sign-in joins the account (as pending, unless it is already known) and gets a session. */
  const enterDevice = (account: Account, d: LoginFinish["device"]) => {
    let device = account.devices.find((x) => x.signing_key === d.signing_key);
    if (!device) {
      device = {
        id: uuid(), name: d.name, platform: d.platform, state: "pending", signing_key: d.signing_key,
        agreement_key: d.agreement_key, created_at: new Date(now()).toISOString(), approved_by: null, approval_signature: null, current: false,
      };
      account.devices.push(device);
    }
    return createSession(account, device);
  };

  /** An unused recovery code works once. */
  const spendRecovery = (account: Account, code: string) => {
    const at = account.totp?.recovery.indexOf(code) ?? -1;
    if (at < 0) return false;
    account.totp!.recovery.splice(at, 1);
    return true;
  };

  const createSession = (account: Account, device: Device) => {
    const token = `token-${uuid()}`;
    sessions.set(token, { accountId: account.id, deviceId: device.id });
    return { token, account_id: account.id, device_id: device.id, device_state: device.state, expires_at: expiry() };
  };

  const publicKeys = (d: { signing_key: string; agreement_key: string }) => ({ signing: decodeBytes(d.signing_key), agreement: decodeBytes(d.agreement_key) });

  async function handle(url: string, init: RequestInit = {}): Promise<Response> {
    const path = url.replace(/^https?:\/\/[^/]+/, "");
    const method = init.method ?? "GET";
    const headers = (init.headers ?? {}) as Record<string, string>;
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    const authorization = headers.authorization ?? null;
    calls.push({ method, path, body, authorization });

    const refusal = refusals.find((r) => path.startsWith(r.path) && r.times > 0);
    if (refusal) {
      refusal.times -= 1;
      return fail(refusal.status, refusal.code, refusal.message);
    }

    if (method === "POST" && path === "/v1/accounts/register/start") {
      const b = body as RegisterStart;
      if (!normalizeEmail(b.email)) return fail(400, "invalid_email", "The email address is not valid.");
      return json(200, { registration_response: encodeBytes(utf8("fake-registration-response")) });
    }

    if (method === "POST" && path === "/v1/accounts/register/finish") {
      const b = body as RegisterFinish;
      const email = normalizeEmail(b.email);
      if (!email) return fail(400, "invalid_email", "The email address is not valid.");
      const upload = decodeBytes(b.registration_upload);
      const keys = publicKeys(b.device);
      if (!fakeVerify(keys.signing, DEVICE_REGISTER_CONTEXT, registerMessage(email, upload, keys), decodeBytes(b.device_signature))) {
        return fail(400, "invalid_signature", "The signature is not valid.");
      }
      // No account and no session yet: the sign-up waits for a code. A taken address gets the same answer, belonging to nobody.
      const signupId = uuid();
      if (!accounts.has(email)) signups.set(signupId, { email, upload, device: b.device, code: nextCode(), wrong: 0, sentAt: now(), resends: 0 });
      return json(201, { signup_id: signupId });
    }

    if (method === "POST" && path === "/v1/accounts/email/verify") {
      const b = body as { signup_id: string; code: string };
      const pending = signups.get(b.signup_id);
      const refuse = () => fail(400, "invalid_email_code", "That code didn't work.");
      if (!pending) return refuse();
      if (now() - pending.sentAt > 30 * 60_000) {
        signups.delete(b.signup_id);
        return refuse();
      }
      if (b.code !== pending.code) {
        if (++pending.wrong >= 5) signups.delete(b.signup_id);
        return refuse();
      }
      signups.delete(b.signup_id);
      if (accounts.has(pending.email)) return refuse();
      const device: Device = {
        id: uuid(), name: pending.device.name, platform: pending.device.platform, state: "trusted", signing_key: pending.device.signing_key,
        agreement_key: pending.device.agreement_key, created_at: new Date(now()).toISOString(), approved_by: null, approval_signature: null, current: false,
      };
      const account: Account = { id: uuid(), email: pending.email, verifier: pending.upload.slice("fake-upload:".length), devices: [device] };
      accounts.set(pending.email, account);
      return json(201, createSession(account, device));
    }

    if (method === "POST" && path === "/v1/accounts/email/resend") {
      const pending = signups.get((body as { signup_id: string }).signup_id);
      // Three an hour; the answer is 204 whatever happens, so nothing tells a real sign-up from a decoy.
      if (pending && pending.resends < 3) {
        pending.resends++;
        pending.code = nextCode();
        pending.sentAt = now();
        pending.wrong = 0;
      }
      return json(204, null);
    }

    if (method === "POST" && path === "/v1/sessions/login/start") {
      const b = body as LoginStart;
      const email = normalizeEmail(b.email);
      if (!email) return fail(400, "invalid_email", "The email address is not valid.");
      const account = accounts.get(email);
      let provedTrusted = false;
      if (b.trusted_device && account) {
        const device = account.devices.find((d) => d.state === "trusted" && d.signing_key === b.trusted_device!.signing_key);
        const request = decodeBytes(b.credential_request);
        const signedAt = Number(b.trusted_device.signed_at);
        provedTrusted = Boolean(device) && Math.abs(now() / 1000 - signedAt) <= 300 &&
          fakeVerify(decodeBytes(b.trusted_device.signing_key), TRUSTED_START_CONTEXT, trustedStartMessage(email, request, signedAt), decodeBytes(b.trusted_device.signature));
      }
      if (provedTrusted) state.trustedProofs += 1;
      else {
        const n = (state.attemptsPerEmail.get(email) ?? 0) + 1;
        state.attemptsPerEmail.set(email, n);
        if (n > 10) return fail(429, "too_many_attempts", "Too many attempts.");
      }
      const loginId = uuid();
      logins.set(loginId, { email, trusted: provedTrusted });
      // An unknown email gets a made-up answer, so sign-in never says whether an account exists.
      const verifier = account?.verifier ?? new Uint8Array(32).fill(7);
      return json(200, { login_id: loginId, credential_response: encodeBytes(new Uint8Array([...utf8("fake-login-response:"), ...verifier])) });
    }

    if (method === "POST" && path === "/v1/sessions/login/finish") {
      const b = body as LoginFinish;
      const login = logins.get(b.login_id);
      const account = login ? accounts.get(login.email) : undefined;
      if (!login || !account) return fail(401, "login_failed", "Login failed.");
      logins.delete(b.login_id);
      const keys = publicKeys(b.device);
      if (!fakeVerify(keys.signing, DEVICE_LOGIN_CONTEXT, loginMessage(b.login_id, keys), decodeBytes(b.device_signature))) {
        return fail(400, "invalid_signature", "The signature is not valid.");
      }
      state.attemptsPerEmail.delete(login.email);
      // Two-factor on, and the start wasn't proven by a trusted device: no session until a code comes.
      if (account.totp?.enabled && !login.trusted) {
        waiting.set(b.login_id, { email: login.email, device: b.device, wrong: 0 });
        return json(401, { code: "second_factor_required", message: "Send the code from your authenticator app to finish signing in.", login_id: b.login_id });
      }
      return json(200, enterDevice(account, b.device));
    }

    if (method === "POST" && path === "/v1/sessions/login/second-factor") {
      const b = body as { login_id: string; code: string | null; recovery_code: string | null };
      const pending = waiting.get(b.login_id);
      const account = pending ? accounts.get(pending.email) : undefined;
      if (!pending || !account?.totp) return fail(401, "login_failed", "Login failed.");
      if ((b.code === null) === (b.recovery_code === null)) return fail(400, "invalid_request", "Send one of code and recovery_code.");
      const ok = b.code !== null ? b.code === MOCK_TOTP_CODE : spendRecovery(account, b.recovery_code!);
      if (!ok) {
        if (++pending.wrong >= 5) waiting.delete(b.login_id);
        return fail(401, "second_factor_failed", "That code didn't work.");
      }
      waiting.delete(b.login_id);
      return json(200, enterDevice(account, pending.device));
    }

    // Everything below needs a session.
    const who = session(authorization?.replace(/^Bearer /, "") ?? null);
    if (!who) return fail(401, "unauthorized", "Unauthorized.");
    const { account, device } = who;
    const view = (d: Device): Device => ({ ...d, current: d.id === device.id });

    if (method === "DELETE" && path === "/v1/sessions/current") {
      for (const [t, s] of sessions) if (s.deviceId === device.id && authorization?.endsWith(t)) sessions.delete(t);
      return json(204, null);
    }
    if (path.startsWith("/v1/keychain/protection")) {
      if (device.state !== "trusted") return fail(403, "device_not_trusted", "This device isn't trusted.");
      const chain = (account.protection ??= []);
      if (method === "GET") {
        const from = account.protectionFromStart ? 1 : Number(new URL(`http://x${path}`).searchParams.get("from") ?? 1);
        return json(200, { links: chain.filter((l) => l.seq >= from).slice(0, 100), more: chain.filter((l) => l.seq >= from).length > 100 });
      }
      if (method === "POST") {
        const b = body as { level: ProtectionLink["level"]; seq: number; prev: string; signed_at: number | bigint; device_signature: string };
        const signedAt = Number(b.signed_at);
        const verified =
          Math.abs(now() / 1000 - signedAt) <= 300 &&
          fakeVerify(decodeBytes(device.signing_key), PROTECTION_CONTEXT, protectionMessage(account.id, device.id, b.level, b.seq, b.prev, signedAt), decodeBytes(b.device_signature));
        if (!verified) return fail(400, "invalid_signature", "The signature is not valid.");
        const head = chain.at(-1);
        if (b.seq !== (head?.seq ?? 0) + 1 || b.prev !== (head ? protectionHash(account.id, head) : PROTECTION_GENESIS)) {
          return json(409, { code: "protection_conflict", message: "The setting does not follow the current one.", ...(head ? { head } : {}) });
        }
        const link: ProtectionLink = { level: b.level, seq: b.seq, prev: b.prev, signed_at: signedAt as unknown as bigint, signer_device_id: device.id, signature: b.device_signature };
        chain.push(link);
        return json(201, link);
      }
    }
    if (path.startsWith("/v1/accounts/totp") && method === "POST") {
      if (device.state !== "trusted") return fail(403, "device_not_trusted", "This device isn't trusted.");
      const b = body as { code?: string; device_signature?: string | null; signed_at?: number | bigint | null };
      const action = path === "/v1/accounts/totp" ? "enrol" : path.endsWith("/confirm") ? "confirm" : "disable";
      // A bare token is not enough: the device signs the account, itself, the action, the code and the time.
      const signedAt = Number(b.signed_at ?? NaN);
      const proven =
        typeof b.device_signature === "string" &&
        Math.abs(now() / 1000 - signedAt) <= 300 &&
        fakeVerify(decodeBytes(device.signing_key), TOTP_MANAGE_CONTEXT, totpManageMessage(account.id, device.id, action, action === "confirm" ? (b.code ?? "") : "", signedAt), decodeBytes(b.device_signature));
      // Accepted once: each signature must be strictly later than the last one this device had accepted for the action.
      const slot = `${device.id}:${action}`;
      if (!proven || signedAt <= (state.lastManage.get(slot) ?? 0)) return fail(401, "device_proof_required", "This request needs the device's signature.");
      state.lastManage.set(slot, signedAt);
      if (action === "enrol") {
        if (account.totp?.enabled) return fail(409, "totp_already_enabled", "Two-factor is already on.");
        account.totp = { enabled: false, recovery: [] };
        return json(200, { secret: MOCK_TOTP_SECRET, uri: `otpauth://totp/Orbyn:${account.email}?secret=${MOCK_TOTP_SECRET}&issuer=Orbyn&algorithm=SHA1&digits=6&period=30` });
      }
      if (action === "confirm") {
        if (account.totp?.enabled) return fail(409, "totp_already_enabled", "Two-factor is already on.");
        if (!account.totp || b.code !== MOCK_TOTP_CODE) return fail(401, "second_factor_failed", "That code didn't work.");
        account.totp = { enabled: true, recovery: Array.from({ length: 10 }, (_, i) => `RECOV-${String(i + 1).padStart(5, "0")}`) };
        return json(200, { recovery_codes: [...account.totp.recovery] });
      }
      if (!account.totp?.enabled) return fail(409, "totp_not_enabled", "Two-factor isn't on.");
      delete account.totp;
      return json(204, null);
    }
    const open = (a: Approval | undefined) => (a && !a.closed && now() <= a.expiresAt ? a : undefined);
    const keysOf = (id: string) => account.devices.find((d) => d.id === id)!;
    const viewOf = (a: Approval): PendingApproval => {
      const approver = keysOf(a.approverId);
      const target = keysOf(a.deviceId);
      return {
        id: a.id, expires_at: new Date(a.expiresAt).toISOString(), created_at: a.createdAt, approver_id: approver.id, approver_signing_key: approver.signing_key,
        approver_agreement_key: approver.agreement_key, device_id: target.id, device_signing_key: target.signing_key, device_agreement_key: target.agreement_key,
        commitment: a.commitment, device_nonce: a.deviceNonce, approver_nonce: a.approverNonce, signature: a.signature, endorsement: a.endorsement,
      };
    };
    const approvalOf = (p: string) => approvals.get(p.split("/")[4]!);

    if (method === "GET" && path === "/v1/devices/current") {
      const approval = [...approvals.values()].find((a) => a.deviceId === device.id && open(a));
      return json(200, { device: view(device), approval: approval ? viewOf(approval) : null, totp_enabled: account.totp?.enabled === true, totp_pending: account.totp !== undefined && !account.totp.enabled });
    }
    if (method === "GET" && /^\/v1\/devices\/approvals\/[^/]+$/.test(path)) {
      const a = approvalOf(path);
      if (!a || (a.approverId !== device.id && a.deviceId !== device.id)) return fail(404, "not_found", "Not found.");
      return open(a) ? json(200, viewOf(a)) : fail(410, "approval_expired", "The approval has expired.");
    }
    if (method === "POST" && /^\/v1\/devices\/approvals\/[^/]+\/nonce$/.test(path)) {
      const a = approvalOf(path);
      if (!a || a.deviceId !== device.id) return fail(404, "not_found", "Not found.");
      if (!open(a)) return fail(410, "approval_expired", "The approval has expired.");
      if (a.deviceNonce || a.approverNonce) return fail(409, "approval_out_of_order", "That step was already done.");
      a.deviceNonce = (body as ApprovalNonce).nonce;
      return json(204, null);
    }
    if (method === "POST" && /^\/v1\/devices\/approvals\/[^/]+\/cancel$/.test(path)) {
      const a = approvalOf(path);
      if (!a || (a.approverId !== device.id && a.deviceId !== device.id)) return fail(404, "not_found", "Not found.");
      a.closed = true;
      return json(204, null);
    }
    if (method === "POST" && /^\/v1\/devices\/approvals\/[^/]+\/code$/.test(path)) {
      const a = approvalOf(path);
      if (!a || a.deviceId !== device.id || !open(a)) return fail(410, "approval_expired", "The approval has expired.");
      if (!a.signature || !a.approverNonce || !a.deviceNonce) return fail(409, "approval_not_confirmed", "The approver has not confirmed yet.");
      // One try: the server computes the digits from the public values and closes the approval either way.
      const v = viewOf(a);
      const sas = fakeSas(pairingBytes(partsOfView(account.id, v)), decodeBytes(a.approverNonce), decodeBytes(a.deviceNonce));
      a.closed = true;
      if ((body as { code: string }).code !== sas) return fail(400, "wrong_code", "The code is wrong. Attempts left: 0.");
      device.state = "trusted"; // or, for a device approved again, stays so with the new approver and signature
      device.approved_by = a.approverId;
      device.approval_signature = a.signature;
      return json(200, view(device));
    }

    if (device.state !== "trusted") return fail(403, "device_not_trusted", "This device is not trusted.");

    if (method === "GET" && path === "/v1/devices") return json(200, { devices: account.devices.map(view), removals: account.removals ?? [] });
    if (method === "DELETE" && path === "/v1/sessions") {
      for (const [t, s] of sessions) if (s.accountId === account.id) sessions.delete(t);
      return json(204, null);
    }
    if (method === "POST" && path === "/v1/devices/approvals") {
      const b = body as CreateApproval;
      // A pending device, or a trusted one approved again; the server cannot tell why.
      const pending = account.devices.find((d) => d.id === b.device_id && d.id !== device.id);
      if (!pending) return fail(404, "not_found", "Not found.");
      if (Math.abs(now() / 1000 - b.created_at) > 300) return fail(400, "invalid_request", "The time is too far from the server's.");
      if (approvals.has(b.approval_id)) return fail(409, "invalid_request", "That approval id was used.");
      const approval: Approval = {
        id: b.approval_id, accountId: account.id, approverId: device.id, deviceId: pending.id, createdAt: b.created_at, expiresAt: now() + 600_000,
        commitment: b.commitment, deviceNonce: null, approverNonce: null, signature: null, endorsement: null, closed: false,
      };
      approvals.set(approval.id, approval);
      return json(201, { id: approval.id, expires_at: new Date(approval.expiresAt).toISOString() });
    }
    if (method === "POST" && /^\/v1\/devices\/approvals\/[^/]+\/reveal$/.test(path)) {
      const a = approvalOf(path);
      if (!a || a.approverId !== device.id) return fail(404, "not_found", "Not found.");
      if (!open(a)) return fail(410, "approval_expired", "The approval has expired.");
      if (!a.deviceNonce || a.approverNonce) return fail(409, "approval_out_of_order", "That step is not next.");
      const nonce = (body as ApprovalNonce).nonce;
      const pairing = pairingBytes(partsOfView(account.id, viewOf(a)));
      if (encodeBytes(fakeCommitment(pairing, decodeBytes(nonce))) !== a.commitment) {
        a.closed = true;
        return fail(400, "invalid_commitment", "That nonce does not match the commitment.");
      }
      a.approverNonce = nonce;
      return json(204, null);
    }
    if (method === "POST" && /^\/v1\/devices\/approvals\/[^/]+\/confirm$/.test(path)) {
      const a = approvalOf(path);
      if (!a || a.approverId !== device.id) return fail(404, "not_found", "Not found.");
      if (!open(a)) return fail(410, "approval_expired", "The approval has expired.");
      if (!a.approverNonce || a.signature) return fail(409, "approval_out_of_order", "That step is not next.");
      a.signature = (body as ConfirmApproval).signature;
      a.endorsement = (body as ConfirmApproval).endorsement ?? null;
      return json(204, null);
    }
    if (method === "DELETE" && /^\/v1\/devices\/[^/]+$/.test(path)) {
      // The remover's sequence (at most 2^53 - 1) and signature are required, as the engine requires them.
      const b = body as { sequence?: unknown; signature?: unknown } | undefined;
      if (typeof b?.sequence !== "number" || !Number.isSafeInteger(b.sequence) || b.sequence < 0 || typeof b.signature !== "string" || b.signature === "") {
        return fail(400, "invalid_request", "A removal needs its sequence and signature.");
      }
      const target = account.devices.find((d) => d.id === path.split("/")[3]);
      if (!target) return fail(404, "not_found", "Not found.");
      if (target.state === "trusted" && account.devices.filter((d) => d.state === "trusted").length === 1) {
        return fail(409, "last_trusted_device", "The last trusted device cannot be removed.");
      }
      account.devices = account.devices.filter((d) => d.id !== target.id);
      (account.removals ??= []).push({ device_id: target.id, signing_key: target.signing_key, agreement_key: target.agreement_key, removed_by: device.id, sequence: b.sequence, signature: b.signature });
      for (const [t, s] of sessions) if (s.deviceId === target.id) sessions.delete(t);
      return json(204, null);
    }
    // The record store: zones, changes and key envelopes.
    account.records ??= newMockRecords();
    const stored = recordStoreRoute(
      { records: account.records, trustedDevices: account.devices.filter((d) => d.state === "trusted").map((d) => d.id), deviceId: device.id, now, notify: (zone, token, author) => subscribers.forEach((fn) => fn(account.id, zone, token, author)) },
      method,
      path,
      body,
    );
    if (stored) return stored;
    return fail(404, "not_found", "Not found.");
  }

  return {
    /** Called for every committed upload: the server's live notice, which the socket mock forwards. */
    subscribe: (fn: (accountId: string, zone: string, token: string, author: string) => void) => {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
    fetch: handle as unknown as typeof fetch,
    calls,
    accounts,
    sessions,
    state,
    /** The code the mock "emailed" for a sign-up, or undefined for a decoy, a closed or an unknown one. */
    emailCode: (signupId: string) => signups.get(signupId)?.code,
    /** The code last "emailed" to an address with a live sign-up. */
    latestEmailCode: (address: string) => [...signups.values()].filter((s) => s.email === normalizeEmail(address)).at(-1)?.code,
    refuseNext(path: string, status: number, code: string, message = "Refused.", times = 1) {
      refusals.push({ path, status, code, message, times });
    },
    /** Ends every session on the server, as if they expired: the next signed-in call is a 401. */
    expireAllSessions() {
      sessions.clear();
    },
  };
}

export type MockEngine = ReturnType<typeof createMockEngine>;
