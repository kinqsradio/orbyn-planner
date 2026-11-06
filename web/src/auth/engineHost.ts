import type { ApprovalEngine, AuthCrypto } from "../api/authCrypto";
import type { KeyStore, StoredSession } from "../api/keyStore";
import { ApiFailure } from "../api/auth";

/** Runs `fn` with nothing else in the same browser running one at the same time. */
export type Lock = <T>(fn: () => Promise<T>) => Promise<T>;

const LOCK_NAME = "orbyn-planner-engine";
let chain: Promise<unknown> = Promise.resolve();

/**
 * One writer for the sync engine's state across tabs: a Web Lock shared by every tab of this
 * origin. Without Web Locks (an old browser, a test) calls in this page still go one at a time.
 */
export const browserLock: Lock = (fn) => {
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  if (locks) return locks.request(LOCK_NAME, fn) as Promise<never>;
  const next = chain.then(fn, fn);
  chain = next.catch(() => undefined);
  return next;
};

export interface EngineHost {
  /**
   * Runs one action on this device's engine. Under the lock it reads the sealed snapshot from the
   * key store (so what another tab saved is included), restores the engine or, for a device with no
   * snapshot yet, starts one that trusts only itself, runs `fn`, and saves the new snapshot sealed.
   * Do not call `run` from inside `fn`.
   */
  run<T>(session: StoredSession, fn: (engine: ApprovalEngine) => T | Promise<T>): Promise<T>;
}

export function createEngineHost(deps: {
  keys: KeyStore;
  crypto: () => AuthCrypto;
  wrapSecret: () => Promise<Uint8Array>;
  now: () => number;
  lock?: Lock;
}): EngineHost {
  const lock = deps.lock ?? browserLock;
  return {
    run: (session, fn) =>
      lock(async () => {
        const crypto = deps.crypto();
        const wrap = await deps.wrapSecret();
        const saved = await deps.keys.loadKeys();
        if (!saved) throw new ApiFailure("device_not_trusted", 403, "This device has no keys, so it can’t take part in an approval.");
        const keys = crypto.deviceKeys.import(saved, wrap);
        const snapshot = await deps.keys.loadSnapshot();
        let engine: ApprovalEngine | null = null;
        if (snapshot) {
          try {
            engine = crypto.engine.restore(keys, snapshot, wrap, deps.now());
          } catch {
            // Sealed under another secret, changed, or for other keys: it can't be trusted. Start over from self.
            await deps.keys.clearSnapshot();
          }
        }
        engine ??= crypto.engine.create(keys, session.accountId, session.deviceId);
        try {
          return await fn(engine);
        } finally {
          // Saved also after a refusal: counting a list or pinning a device is not undone by one.
          try {
            await deps.keys.saveSnapshot(engine.snapshot(wrap));
          } catch {
            // Still works for this visit; the next action starts from what was last saved.
          }
        }
      }),
  };
}
