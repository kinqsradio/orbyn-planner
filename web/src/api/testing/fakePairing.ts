import type { PendingApproval } from "../../generated/PendingApproval";
import { concat, utf8 } from "../bytes";
import { fakeDigest } from "./FakeAuthCrypto";

/**
 * The two-way comparison with a stand-in hash, for tests ONLY (the real one is orbyn-auth-client's
 * `Pairing`, reached through orbyn-wasm). It binds the same things: the account, the approval id and
 * time, both device ids and both devices' keys, so a test that changes any of them sees the digits
 * or the commitment differ.
 */
export interface PairingParts {
  accountId: string;
  approvalId: string;
  createdAt: number;
  approverId: string;
  approverSigning: string;
  approverAgreement: string;
  deviceId: string;
  deviceSigning: string;
  deviceAgreement: string;
}

export const APPROVAL_CONTEXT = "orbyn/device-approval/v1";

export function pairingBytes(p: PairingParts): Uint8Array {
  return utf8([p.accountId, p.approvalId, p.createdAt, p.approverId, p.approverSigning, p.approverAgreement, p.deviceId, p.deviceSigning, p.deviceAgreement].join("|"));
}

export const fakeCommitment = (pairing: Uint8Array, approverNonce: Uint8Array) => fakeDigest(utf8("commit"), pairing, approverNonce);

/** Six digits from the pairing and both nonces. */
export function fakeSas(pairing: Uint8Array, approverNonce: Uint8Array, deviceNonce: Uint8Array): string {
  const d = fakeDigest(utf8("sas"), pairing, approverNonce, deviceNonce);
  const n = ((d[0]! << 24) | (d[1]! << 16) | (d[2]! << 8) | d[3]!) >>> 0;
  return String(n % 1_000_000).padStart(6, "0");
}

export function partsOfView(accountId: string, v: PendingApproval): PairingParts {
  return {
    accountId, approvalId: v.id, createdAt: v.created_at, approverId: v.approver_id, approverSigning: v.approver_signing_key,
    approverAgreement: v.approver_agreement_key, deviceId: v.device_id, deviceSigning: v.device_signing_key, deviceAgreement: v.device_agreement_key,
  };
}

/** What the approver signs when the person confirms: the pairing, bound to both nonces. */
export const confirmMessage = (pairing: Uint8Array, approverNonce: Uint8Array, deviceNonce: Uint8Array) => concat(pairing, approverNonce, deviceNonce);
