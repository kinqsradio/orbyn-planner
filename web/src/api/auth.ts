import type { ApiError } from "../generated/ApiError";
import type { ApprovalCode } from "../generated/ApprovalCode";
import type { ApprovalNonce } from "../generated/ApprovalNonce";
import type { ConfirmApproval } from "../generated/ConfirmApproval";
import type { PendingApproval } from "../generated/PendingApproval";
import type { ApprovalCreated } from "../generated/ApprovalCreated";
import type { CreateApproval } from "../generated/CreateApproval";
import type { CurrentDevice } from "../generated/CurrentDevice";
import type { Device } from "../generated/Device";
import type { DeviceList } from "../generated/DeviceList";
import type { LoginFinish } from "../generated/LoginFinish";
import type { LoginStart } from "../generated/LoginStart";
import type { LoginStarted } from "../generated/LoginStarted";
import type { RegisterFinish } from "../generated/RegisterFinish";
import type { RegisterStart } from "../generated/RegisterStart";
import type { RegisterStarted } from "../generated/RegisterStarted";
import type { SessionCreated } from "../generated/SessionCreated";
import { engineUrl } from "./engine";

/** What went wrong, in words a person can use. */
const MESSAGES: Record<string, string> = {
  too_many_attempts: "Too many attempts. Wait a little while, then try again.",
  email_unavailable: "That email can’t be used for a new account. If it’s yours, sign in instead.",
  login_failed: "That email and password don’t match.",
  device_not_trusted: "This device hasn’t been approved yet. Approve it from a device you already trust.",
  last_trusted_device: "This is your last trusted device. Approve another device first, then remove this one.",
  approval_expired: "That approval ran out of time or was closed. Start again from a trusted device.",
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

  async function call<T>(method: string, path: string, body?: unknown, authed = false): Promise<T> {
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
    // A 401 on a signed-in call ends the session, whatever the code.
    if (authed && response.status === 401) options.onUnauthorized();
    throw new ApiFailure(code, response.status, plainMessage(code), error.message ?? "");
  }

  return {
    registerStart: (body: RegisterStart) => call<RegisterStarted>("POST", "/v1/accounts/register/start", body),
    registerFinish: (body: RegisterFinish) => call<SessionCreated>("POST", "/v1/accounts/register/finish", body),
    /** `trusted_device` is the optional proof from a device already trusted on the account. */
    loginStart: (body: LoginStart) => call<LoginStarted>("POST", "/v1/sessions/login/start", body),
    loginFinish: (body: LoginFinish) => call<SessionCreated>("POST", "/v1/sessions/login/finish", body),
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
    removeDevice: (id: string) => call<void>("DELETE", `/v1/devices/${encodeURIComponent(id)}`, undefined, true),
  };
}

export type AuthApi = ReturnType<typeof createAuthApi>;
