import type { DeviceList } from "../../generated/DeviceList";
import type { ProtectionChain } from "../../generated/ProtectionChain";
import type { ProtectionLevel } from "../../generated/ProtectionLevel";
import type { ProtectionLink } from "../../generated/ProtectionLink";
import type { SetProtection } from "../../generated/SetProtection";
import type { DeviceKeys, ProtectionApi, ProtectionView } from "../authCrypto";
import { decodeBytes, encodeBytes, utf8 } from "../bytes";
import { fakeDigest, fakeVerify } from "./FakeAuthCrypto";

/**
 * The signed protection setting with a stand-in hash and signature, for tests ONLY (the real one is the engine's, through orbyn-wasm).
 * It keeps the engine's rules that the planner depends on: settings form a chain by `prev`, only a device this device verifies can
 * extend it, a chain older than the verified head is a rollback, another link at a verified sequence is a fork, and nothing but a
 * walk to the server's head makes a level `verified`.
 */
export const PROTECTION_CONTEXT = "orbyn/protection/v1";
export const PROTECTION_GENESIS = encodeBytes(new Uint8Array(32));

/** What a device signs for one setting. */
export const protectionMessage = (accountId: string, signerId: string, level: ProtectionLevel, seq: number, prev: string, signedAt: number) =>
  utf8(["protection", accountId, signerId, level, seq, prev, signedAt].join("|"));

/** The `prev` the next link names: the hash of this one's signed message. */
export const protectionHash = (accountId: string, link: Pick<ProtectionLink, "signer_device_id" | "level" | "seq" | "prev" | "signed_at">) =>
  encodeBytes(fakeDigest(protectionMessage(accountId, link.signer_device_id, link.level, link.seq, link.prev, Number(link.signed_at))));

export interface ProtectionState {
  head: { seq: number; hash: string; level: ProtectionLevel } | null;
  /** The last walk reached the server's head with nothing stopped. */
  complete: boolean;
}

export function fakeProtection(keys: DeviceKeys, accountId: string, deviceId: string, state: ProtectionState, verifiedDevices: (list: DeviceList) => string[]): ProtectionApi {
  const view = (stopped: ProtectionView["stopped"] = null): ProtectionView => {
    const h = state.head;
    if (!h) return { seq: 0, state: "unknown", stopped };
    return { seq: h.seq, state: state.complete && !stopped ? "verified" : "provisional", level: h.level, stopped };
  };
  const body = (level: ProtectionLevel, seq: number, prev: string, nowSecs: number): SetProtection => ({
    level,
    seq,
    prev,
    signed_at: BigInt(nowSecs),
    device_signature: encodeBytes(keys.sign(PROTECTION_CONTEXT, protectionMessage(accountId, deviceId, level, seq, prev, nowSecs))),
  });
  return {
    sign: (level, nowSecs) => body(level, (state.head?.seq ?? 0) + 1, state.head?.hash ?? PROTECTION_GENESIS, nowSecs),
    resign: (level, head, nowSecs) => body(level, head.seq + 1, protectionHash(accountId, head), nowSecs),
    verify(chain: ProtectionChain, list: DeviceList) {
      const trusted = new Set(verifiedDevices(list));
      const links = [...chain.links].sort((a, b) => a.seq - b.seq);
      const last = links.at(-1);
      if (state.head && last && last.seq < state.head.seq && !chain.more) throw new Error("protection_rollback: the chain is older than the newest setting this device verified");
      let stopped: ProtectionView["stopped"] = null;
      for (const link of links) {
        if (state.head && link.seq <= state.head.seq) {
          if (link.seq === state.head.seq && protectionHash(accountId, link) !== state.head.hash) throw new Error("protection_fork: another setting at a sequence this device verified");
          continue;
        }
        const next = (state.head?.seq ?? 0) + 1;
        const signer = list.devices.find((d) => d.id === link.signer_device_id);
        if (link.seq !== next || link.prev !== (state.head?.hash ?? PROTECTION_GENESIS)) {
          stopped = link.seq !== next ? "gap" : "invalid";
          break;
        }
        if (!signer || !trusted.has(signer.id)) {
          stopped = "untrusted_signer";
          break;
        }
        const ok = fakeVerify(decodeBytes(signer.signing_key), PROTECTION_CONTEXT, protectionMessage(accountId, signer.id, link.level, link.seq, link.prev, Number(link.signed_at)), decodeBytes(link.signature));
        if (!ok) {
          stopped = "invalid_signature";
          break;
        }
        state.head = { seq: link.seq, hash: protectionHash(accountId, link), level: link.level };
      }
      state.complete = stopped === null && !chain.more && links.length > 0 && state.head?.seq === last?.seq;
      return view(stopped);
    },
    from: () => state.head?.seq ?? 1,
    level: () => view(),
  };
}
