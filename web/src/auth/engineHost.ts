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

export const SNAPSHOT_UNREADABLE = "This device’s saved trust state couldn’t be used, so it is starting fresh. The old copy is kept. You may need to approve your other devices again.";

/**
 * What the person should know about the saved state. It is shown whenever the key store holds a
 * quarantined snapshot, so it survives a reload and reaches every tab; dismissing hides it for this
 * page until another snapshot is quarantined.
 */
export interface Notice {
  get(): string | null;
  subscribe(listener: () => void): () => void;
  /** Hides it on this page. */
  clear(): void;
  /** Reads the key store again (on opening a screen that shows it, or when another tab says something changed). */
  refresh(): Promise<void>;
}

export interface EngineHost {
  /**
   * Runs one action on this device's engine. Under the lock it reads the sealed snapshot from the
   * key store (so what another tab saved is included), restores the engine or, for a device with no
   * snapshot yet, starts one that trusts only itself, runs `fn`, and saves the new snapshot sealed.
   * If the save fails, `run` fails, so a step that needs the new state (a signed removal, a
   * confirmation) is never sent. Do not call `run` from inside `fn`.
   */
  run<T>(session: StoredSession, fn: (engine: ApprovalEngine) => T | Promise<T>): Promise<T>;
  /** Forgets this device (keys, snapshot, wrapping key), under the same lock so no action is half-saved. Rejects if it could not. */
  forget(): Promise<void>;
  /** Runs `fn` under the engine's lock, for changes to the stored state that must not interleave with an action. Do not call `run` or `forget` from inside. */
  exclusive<T>(fn: () => Promise<T>): Promise<T>;
  /** Something the person should know about the saved state. */
  notice: Notice;
}

const NOTICE_CHANNEL = "orbyn-planner-engine-notice";

function createNotice(keys: KeyStore, wrapKeyPresent: () => Promise<boolean>): Notice & { announce(): Promise<void> } {
  let count = 0;
  let dismissed = false;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());
  const refresh = async () => {
    try {
      // Only while the wrapping key that sealed it exists: otherwise "the old copy is kept" would be untrue.
      const next = (await wrapKeyPresent()) ? (await keys.loadQuarantine()).length : 0;
      if (next !== count) {
        count = next;
        emit();
      }
    } catch {
      // Nothing to show if the store can't be read.
    }
  };
  const react = () => {
    dismissed = false;
    void refresh().then(emit);
  };
  if (typeof BroadcastChannel !== "undefined") {
    const channel = new BroadcastChannel(NOTICE_CHANNEL);
    channel.onmessage = react;
  }
  void refresh();
  return {
    get: () => (count > 0 && !dismissed ? SNAPSHOT_UNREADABLE : null),
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    clear: () => {
      dismissed = true;
      emit();
    },
    refresh,
    /** This tab quarantined something: show it here and tell the other tabs. */
    announce: async () => {
      dismissed = false;
      await refresh();
      emit();
      try {
        const channel = new BroadcastChannel(NOTICE_CHANNEL);
        channel.postMessage("quarantined");
        channel.close();
      } catch {
        // The other tabs read the store when they next open the screen.
      }
    },
  };
}

export function createEngineHost(deps: {
  keys: KeyStore;
  crypto: () => AuthCrypto;
  wrapSecret: () => Promise<Uint8Array>;
  /** Whether the wrapping key still exists. Defaults to looking for it in the key store. */
  wrapKeyPresent?: () => Promise<boolean>;
  now: () => number;
  lock?: Lock;
}): EngineHost {
  const lock = deps.lock ?? browserLock;
  const notice = createNotice(deps.keys, deps.wrapKeyPresent ?? (async () => (await deps.keys.loadWrapKey()) !== null));
  return {
    notice,
    forget: () => lock(() => deps.keys.clearDevice()),
    exclusive: (fn) => lock(fn),
    run: (session, fn) =>
      lock(async () => {
        const crypto = deps.crypto();
        // The keys come first: a device that has been signed out has none, and must not get a new wrapping key here.
        const saved = await deps.keys.loadKeys();
        if (!saved) throw new ApiFailure("device_not_trusted", 403, "This device has no keys, so it can’t take part in an approval.");
        const wrap = await deps.wrapSecret();
        try {
          const keys = crypto.deviceKeys.import(saved, wrap);
          const identity = await deps.keys.loadIdentity();
          let snapshot = await deps.keys.loadSnapshot();
          // State made for another account or device is not this session's: it must not speak for it.
          if (snapshot && (!identity || identity.accountId !== session.accountId || identity.deviceId !== session.deviceId)) {
            // Kept, not dropped: it may hold the zone keys of the account it was made for.
            await deps.keys.quarantineSnapshot(snapshot);
            await deps.keys.clearSnapshot();
            snapshot = null;
            await notice.announce();
          }
          let engine: ApprovalEngine | null = null;
          if (snapshot) {
            try {
              engine = crypto.engine.restore(keys, snapshot, wrap, deps.now());
            } catch (e) {
              // Keep what couldn't be read. Only a genuine open failure (these keys do not open it) drops the live copy.
              await deps.keys.quarantineSnapshot(snapshot);
              if (e instanceof Error && /^open_failed\b/.test(e.message)) await deps.keys.clearSnapshot();
              await notice.announce();
            }
          }
          engine ??= crypto.engine.create(keys, session.accountId, session.deviceId);

          let result: Awaited<ReturnType<typeof fn>> | undefined;
          let failure: unknown;
          let failed = false;
          try {
            result = await fn(engine);
          } catch (e) {
            failed = true;
            failure = e;
          }
          // Saved also after a refusal: counting a list or pinning a device is not undone by one. A
          // failed save is an error of its own unless the action already failed.
          try {
            await deps.keys.saveSnapshot(engine.snapshot(wrap));
            await deps.keys.saveIdentity({ accountId: session.accountId, deviceId: session.deviceId });
          } catch (e) {
            if (!failed) throw e;
          }
          if (failed) throw failure;
          return result as never;
        } finally {
          wrap.fill(0);
        }
      }),
  };
}
