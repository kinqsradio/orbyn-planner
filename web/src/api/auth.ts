import type { ApiError } from "../generated/ApiError";
import type { DeleteZone } from "../generated/DeleteZone";
import type { KeyEnvelopeList } from "../generated/KeyEnvelopeList";
import type { PutKeyEnvelopes } from "../generated/PutKeyEnvelopes";
import type { UploadChanges } from "../generated/UploadChanges";
import type { UploadResult } from "../generated/UploadResult";
import type { Zone } from "../generated/Zone";
import type { ZoneChanges } from "../generated/ZoneChanges";
import type { ZoneDeleted } from "../generated/ZoneDeleted";
import type { ZoneList } from "../generated/ZoneList";
import type { ApprovalCode } from "../generated/ApprovalCode";
import type { ApprovalNonce } from "../generated/ApprovalNonce";
import type { ConfirmApproval } from "../generated/ConfirmApproval";
import type { RemoveDevice } from "../generated/RemoveDevice";
import type { PendingApproval } from "../generated/PendingApproval";
import type { ApprovalCreated } from "../generated/ApprovalCreated";
import type { CreateApproval } from "../generated/CreateApproval";
import type { CurrentDevice } from "../generated/CurrentDevice";
import type { Device } from "../generated/Device";
import type { DeviceList } from "../generated/DeviceList";
import type { LoginFinish } from "../generated/LoginFinish";
import type { LoginStart } from "../generated/LoginStart";
import type { LoginStarted } from "../generated/LoginStarted";
import type { EmailResend } from "../generated/EmailResend";
import type { EmailVerify } from "../generated/EmailVerify";
import type { RegisterFinish } from "../generated/RegisterFinish";
import type { RegisterStart } from "../generated/RegisterStart";
import type { RegisterStarted } from "../generated/RegisterStarted";
import type { SecondFactorLogin } from "../generated/SecondFactorLogin";
import type { SessionCreated } from "../generated/SessionCreated";
import type { SignUpPending } from "../generated/SignUpPending";
import type { TotpConfirm } from "../generated/TotpConfirm";
import type { TotpConfirmed } from "../generated/TotpConfirmed";
import type { TotpDisable } from "../generated/TotpDisable";
import type { TotpEnrol } from "../generated/TotpEnrol";
import type { TotpEnrolment } from "../generated/TotpEnrolment";
import { engineUrl } from "./engine";

/** What went wrong, in words a person can use. */
const MESSAGES: Record<string, string> = {
  too_many_attempts: "Too many attempts. Wait a little while, then try again.",
  too_many_uploads: "Syncing too fast. It will resume in a moment.",
  zone_not_found: "That list or calendar isn’t there any more.",
  zone_deleted: "That list or calendar was deleted on another device.",
  email_unavailable: "That email can’t be used for a new account. If it’s yours, sign in instead.",
  login_failed: "That email and password don’t match.",
  invalid_email_code: "That code didn’t work.",
  second_factor_required: "Enter the code from your authenticator app to finish signing in.",
  second_factor_failed: "That code didn’t work.",
  device_proof_required: "This device couldn’t prove the request. Try again, and check that this device’s clock is right.",
  totp_already_enabled: "Two-factor is already on for this account.",
  totp_not_enabled: "Two-factor isn’t on for this account.",
  device_not_trusted: "This device hasn’t been approved yet. Approve it from a device you already trust.",
  last_trusted_device: "This is your last trusted device. Approve another device first, then remove this one.",
  approval_expired: "That approval ran out of time or was closed. Start again from a trusted device. If this keeps happening, check that this device’s clock is right.",
  approval_out_of_order: "That approval isn’t at that step. Start again.",
  approval_not_confirmed: "The trusted device hasn’t confirmed yet.",
  invalid_commitment: "The two devices didn’t agree, so the approval was closed. Start again.",
  invalid_email: "Enter a valid email address.",
  invalid_device_name: "This device’s name isn’t valid.",
  invalid_signature: "This device couldn’t be verified. Try again.",
  device_key_conflict: "This device is already registered to another account.",
  not_found: "That isn’t there any more.",
  unauthorized: "Your session ended. Sign in again.",
  accounts_unavailable: "Sign-in isn’t set up on this server yet.",
  invalid_request: "That request wasn’t valid. Try again.",
  payload_too_large: "That request was too large.",
  internal: "Something went wrong on the server. Try again in a moment.",
  network: "Can’t reach the server. Check your connection and try again.",
};

/** A failed call: `code` is the engine's error code (or `network`), `message` is for the person. */
export class ApiFailure extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
    /** The server's own message, kept for codes that carry detail, such as the attempts left. */
    readonly serverMessage: string = "",
    /** The whole error body, for answers that carry more than a code (a `record_changed` has the conflicts). */
    readonly body: unknown = null,
    /** Seconds the server asked to wait (`Retry-After`), if it did. */
    readonly retryAfter: number | null = null,
  ) {
    super(message);
    this.name = "ApiFailure";
  }
}

export function plainMessage(code: string): string {
  if (code === "wrong_code") return "The digits didn’t match, so the approval was closed. Start again.";
  return MESSAGES[code] ?? "Something went wrong. Try again.";
}

export interface AuthApiOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
  /** The session token to send as a Bearer header, if there is one. */
  token: () => string | null;
  /** Called when a signed-in call is answered 401: the session is over. */
  onUnauthorized: () => void;
}

/** Typed calls to the engine's account, session and device routes. */
export function createAuthApi(options: AuthApiOptions) {
  const base = () => options.baseUrl ?? engineUrl();
  const doFetch = () => options.fetch ?? fetch;

  /**
   * `keepSession`: this call can be answered 401 with `second_factor_failed` or `device_proof_required`, which are about the request
   * (a wrong code, a signature the engine wouldn't take), not about the session, so they don't end it. Only the three two-factor
   * calls say so; on any other call every 401 ends the session.
   */
  async function call<T>(method: string, path: string, body?: unknown, authed = false, keepSession = false): Promise<T> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers["content-type"] = "application/json";
    const token = options.token();
    if (authed && token) headers.authorization = `Bearer ${token}`;
    let response: Response;
    try {
      response = await doFetch()(`${base()}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? Number(v) : v)),
      });
    } catch {
      throw new ApiFailure("network", 0, MESSAGES.network!);
    }
    if (response.ok) return (response.status === 204 ? undefined : await response.json()) as T;

    let error: Partial<ApiError> = {};
    try {
      error = (await response.json()) as ApiError;
    } catch {
      // Not our JSON (a proxy's page, say): fall back to the status.
    }
    const code = typeof error.code === "string" ? error.code : response.status === 401 ? "unauthorized" : response.status >= 500 ? "internal" : "invalid_request";
    // A 401 on a signed-in call ends the session, except for the two-factor calls' own two answers (see `keepSession`).
    const aboutTheRequest = keepSession && (code === "second_factor_failed" || code === "device_proof_required");
    if (authed && response.status === 401 && !aboutTheRequest) options.onUnauthorized();
    const retry = Number(response.headers.get("retry-after"));
    throw new ApiFailure(code, response.status, plainMessage(code), error.message ?? "", error, Number.isFinite(retry) && retry > 0 ? retry : null);
  }

  return {
    registerStart: (body: RegisterStart) => call<RegisterStarted>("POST", "/v1/accounts/register/start", body),
    /** No account and no session yet: a sign-up waits for the code sent to the address. */
    registerFinish: (body: RegisterFinish) => call<SignUpPending>("POST", "/v1/accounts/register/finish", body),
    /** The six-digit code from the email: creates the account with the signing-up device trusted, and answers its session. */
    emailVerify: (body: EmailVerify) => call<SessionCreated>("POST", "/v1/accounts/email/verify", body),
    /** A new code for a pending sign-up: three an hour, and the answer is the same whatever the id. */
    emailResend: (body: EmailResend) => call<void>("POST", "/v1/accounts/email/resend", body),
    /** `trusted_device` is the optional proof from a device already trusted on the account. */
    loginStart: (body: LoginStart) => call<LoginStarted>("POST", "/v1/sessions/login/start", body),
    loginFinish: (body: LoginFinish) => call<SessionCreated>("POST", "/v1/sessions/login/finish", body),
    /** The second step of a sign-in the engine answered `second_factor_required`: exactly one of a code and a recovery code. */
    loginSecondFactor: (body: SecondFactorLogin) => call<SessionCreated>("POST", "/v1/sessions/login/second-factor", body),
    /** Two-factor, from a trusted device that signs the request: a new secret, pending until confirmed. Shown once. */
    totpEnrol: (body: TotpEnrol) => call<TotpEnrolment>("POST", "/v1/accounts/totp", body, true, true),
    /** A current code from the pending secret turns two-factor on; answers ten recovery codes, shown once. */
    totpConfirm: (body: TotpConfirm) => call<TotpConfirmed>("POST", "/v1/accounts/totp/confirm", body, true, true),
    /** Turns two-factor off: the trusted device's signature alone, no code. */
    totpDisable: (body: TotpDisable) => call<void>("POST", "/v1/accounts/totp/disable", body, true, true),
    /** Ends this device's session. */
    signOut: () => call<void>("DELETE", "/v1/sessions/current", undefined, true),
    /** Ends every session; a trusted device only. */
    signOutEverywhere: () => call<void>("DELETE", "/v1/sessions", undefined, true),
    devices: () => call<DeviceList>("GET", "/v1/devices", undefined, true),
    currentDevice: () => call<CurrentDevice>("GET", "/v1/devices/current", undefined, true),
    createApproval: (body: CreateApproval) => call<ApprovalCreated>("POST", "/v1/devices/approvals", body, true),
    /** An approval as either of its devices sees it. */
    approval: (id: string) => call<PendingApproval>("GET", `/v1/devices/approvals/${encodeURIComponent(id)}`, undefined, true),
    /** Step 2, from the new device. */
    submitNonce: (id: string, body: ApprovalNonce) => call<void>("POST", `/v1/devices/approvals/${encodeURIComponent(id)}/nonce`, body, true),
    /** Step 3, from the approver. */
    revealNonce: (id: string, body: ApprovalNonce) => call<void>("POST", `/v1/devices/approvals/${encodeURIComponent(id)}/reveal`, body, true),
    /** Step 4, from the approver, after the person confirmed the digits match. */
    confirmApproval: (id: string, body: ConfirmApproval) => call<void>("POST", `/v1/devices/approvals/${encodeURIComponent(id)}/confirm`, body, true),
    /** Closes the approval, from either device. */
    cancelApproval: (id: string) => call<void>("POST", `/v1/devices/approvals/${encodeURIComponent(id)}/cancel`, undefined, true),
    submitCode: (approvalId: string, body: ApprovalCode) =>
      call<Device>("POST", `/v1/devices/approvals/${encodeURIComponent(approvalId)}/code`, body, true),
    /** The body is the remover's sequence and signature, made by `signRemoval`. */
    // The record store ---------------------------------------------------------------------------
    /** One page of the account's zones, deleted ones included; `after` is the previous page's `next`. */
    zones: (after?: string) => call<ZoneList>("GET", `/v1/zones${after ? `?after=${encodeURIComponent(after)}` : ""}`, undefined, true),
    /** Creates a zone (or brings a deleted one back, empty). */
    createZone: (zone: string) => call<Zone>("PUT", `/v1/zones/${encodeURIComponent(zone)}`, undefined, true),
    deleteZone: (zone: string, body: DeleteZone) => call<ZoneDeleted>("DELETE", `/v1/zones/${encodeURIComponent(zone)}`, body, true),
    /** Changes after `since` (a token, or none to start from the beginning). */
    changes: (zone: string, since?: string, limit = 200) =>
      call<ZoneChanges>("GET", `/v1/zones/${encodeURIComponent(zone)}/changes?limit=${limit}${since ? `&since=${encodeURIComponent(since)}` : ""}`, undefined, true),
    /** Uploads a batch; a 409 `record_changed` comes back as an ApiFailure whose `body` has the conflicts. */
    upload: (zone: string, body: UploadChanges) => call<UploadResult>("POST", `/v1/zones/${encodeURIComponent(zone)}/changes`, body, true),
    keyEnvelopes: () => call<KeyEnvelopeList>("GET", "/v1/keychain/envelopes", undefined, true),
    putKeyEnvelopes: (body: PutKeyEnvelopes) => call<void>("POST", "/v1/keychain/envelopes", body, true),
    removeDevice: (id: string, body: RemoveDevice) => call<void>("DELETE", `/v1/devices/${encodeURIComponent(id)}`, body, true),
  };
}

export type AuthApi = ReturnType<typeof createAuthApi>;
