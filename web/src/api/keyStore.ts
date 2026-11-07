import type { DeviceState } from "../generated/DeviceState";

/** A signed-in session as it is kept: the token in memory and in IndexedDB, never in localStorage. */
export interface StoredSession {
  token: string;
  accountId: string;
  deviceId: string;
  deviceState: DeviceState;
  expiresAt: string;
  /** What the person typed at sign-in; the engine has no "who am I" route yet. */
  email: string;
  name: string;
}

/**
 * What the sync layer keeps beside the engine's snapshot (which holds the zone keys, sealed). Plain data
 * with no secrets: names and ids the server sees anyway. Cleared with the device.
 */
export interface SyncState {
  /** Zones this device writes to or reads, by name. */
  zones: string[];
  /** The zone each record was last synced to, by "type:id", so a record that moves lists is moved in the store. */
  zoneOf: Record<string, string>;
  /** Outbox entries already staged in the engine, by "type:id" -> idempotency key, so an entry is never staged twice. */
  staged: Record<string, string>;
  /** The zone each staged entry was staged into, so the entry is cleared when that zone has nothing left to send. */
  stagedZone: Record<string, string>;
  /** Per zone, the set of trusted devices (sorted ids joined) its keys were last sent to and the server confirmed. A zone is not uploaded to until this matches the current set. */
  keysSent: Record<string, string>;
  /** Zones this device made (or chose to make) the key for, so a crash between making a zone and its key can't strand it. */
  made: Record<string, true>;
  /** Zones whose key was really sent to a device other than this one (an envelope was put), not merely marked as owed to nobody. */
  keysReached?: Record<string, true>;
  /** True from the moment the engine's snapshot was dropped or replaced until this device has been approved again once: nothing is called stranded, and no delete is offered, while it is true. */
  reset?: boolean;
  /** When (ms) every key was last resent because a device's approval changed, per device: at most once in ten minutes unless an approval completed here. */
  resentAt: Record<string, number>;
  /** Per other trusted device, the approval it was last seen with (its `approval_id`): a change means it was approved again, and every zone key is sent to it again. */
  approvals: Record<string, string>;
  /** Records that can't be sent, by "type:id", with why (too large, say): left out of uploads and shown. */
  failed: Record<string, string>;
  /** Zones skipped for a while after a refusal: the time they may be tried again (ms) and the next wait. */
  backoff: Record<string, { until: number; step: number }>;
  /** Ids of the records the engine could not open yet, by zone, for Settings. */
  quarantined: Record<string, string[]>;
  /** ISO time of the last complete sync. */
  lastSyncedAt: string | null;
}

/** What only the engine's snapshot can vouch for. Dropping or replacing the snapshot makes it untrue. */
export function withoutEngineSide(state: SyncState): SyncState {
  return { ...state, staged: {}, stagedZone: {}, keysSent: {}, keysReached: {}, made: {}, quarantined: {}, reset: true };
}

export const emptySyncState = (): SyncState => ({ zones: [], zoneOf: {}, staged: {}, stagedZone: {}, keysSent: {}, made: {}, approvals: {}, resentAt: {}, failed: {}, backoff: {}, quarantined: {}, lastSyncedAt: null });

/** The account and device the stored keys belong to. */
export interface DeviceIdentity {
  accountId: string;
  deviceId: string;
  /** The normalised email the keys were made for. Keys are never reused for another email, so two accounts can't be linked by one key. */
  email?: string;
}

/** How many unreadable snapshots are kept. */
export const QUARANTINE_KEEP = 3;

/**
 * Where this device keeps its keys and its session. The keys are the bytes the AuthCrypto
 * implementation exported (a non-extractable key cannot be exported, so where the implementation
 * can keep one it hands over only a handle); they live in their own database, not with the planner's data.
 */
export interface KeyStore {
  loadKeys(): Promise<Uint8Array | null>;
  saveKeys(bytes: Uint8Array): Promise<void>;
  clearKeys(): Promise<void>;
  /** The sync engine's state, sealed by the module under the wrapping secret. Never stored unsealed. */
  loadSnapshot(): Promise<Uint8Array | null>;
  saveSnapshot(sealed: Uint8Array): Promise<void>;
  /**
   * Drops the snapshot. The sync state's engine-side parts (what was staged, which keys were sent or made) are reset in the
   * same step, since the engine that knew them is gone: every outbox entry is then staged again from the outbox.
   */
  clearSnapshot(): Promise<void>;
  /** Resets the sync state's engine-side parts without touching the snapshot, for a snapshot that is about to be replaced. */
  resetEngineSide(): Promise<void>;
  /** Which account and device the keys and the snapshot were made for. A session for another one finds them stale. */
  loadIdentity(): Promise<DeviceIdentity | null>;
  saveIdentity(identity: DeviceIdentity): Promise<void>;
  loadSyncState(): Promise<SyncState | null>;
  saveSyncState(state: SyncState): Promise<void>;
  /**
   * Keeps a snapshot that could not be read, sealed as it was, so it isn't lost. The first one kept
   * is pinned (it is the original, with the zone keys) and never pushed out; an identical blob is
   * not kept twice; of the rest the newest fit, up to `QUARANTINE_KEEP` in all. Oldest first.
   */
  quarantineSnapshot(sealed: Uint8Array): Promise<void>;
  loadQuarantine(): Promise<Uint8Array[]>;
  /** The non-extractable WebCrypto key the wrapping secret comes from. It can be stored but not read. */
  loadWrapKey(): Promise<CryptoKey | null>;
  saveWrapKey(key: CryptoKey): Promise<void>;
  /** Forgets this device: keys, snapshot, wrapping key, identity and the quarantine together (all are sealed under, or bound to, the keys). */
  clearDevice(): Promise<void>;
  /**
   * Replaces everything about this device with new keys, in ONE transaction: the old keys, snapshot,
   * wrapping key, identity, sync state and quarantine go, and the new keys, wrapping key (if there is one
   * to store) and identity are written. If anything fails, nothing changes: the old device is as it was,
   * with no moment in which there are keys but no identity. The session is not touched.
   */
  replaceDevice(next: ReplacementDevice): Promise<void>;
  loadSession(): Promise<StoredSession | null>;
  saveSession(session: StoredSession): Promise<void>;
  clearSession(): Promise<void>;
}

/**
 * What `replaceDevice` writes. The engine's snapshot, the sync state, the quarantine and the session are carried over in the same
 * transaction when given (a device moving out of memory), and cleared when not; the session is left alone unless `session` is given.
 */
export interface ReplacementDevice {
  keys: Uint8Array;
  wrapKey: CryptoKey | null;
  identity: DeviceIdentity;
  snapshot?: Uint8Array | null;
  sync?: SyncState | null;
  quarantine?: Uint8Array[];
  session?: StoredSession | null;
}

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

export const KEY_DB_NAME = "orbyn-planner-keys";

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** IndexedDB in a database of its own, `orbyn-planner-keys`, apart from the planner's records. */
export function createIdbKeyStore(factory: IDBFactory = indexedDB): KeyStore {
  let db: Promise<IDBDatabase> | null = null;
  const open = () =>
    (db ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = factory.open(KEY_DB_NAME, 4);
      req.onupgradeneeded = () => {
        for (const name of ["device", "session", "snapshot", "wrap", "identity", "quarantine", "sync"]) {
          if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name);
        }
      };
      req.onsuccess = () => {
        req.result.onversionchange = () => {
          req.result.close();
          db = null;
        };
        resolve(req.result);
      };
      req.onerror = () => {
        db = null;
        reject(req.error);
      };
    }));

  async function get<T>(store: string): Promise<T | null> {
    const database = await open();
    const value = await request<T | undefined>(database.transaction(store, "readonly").objectStore(store).get("current"));
    return value ?? null;
  }
  async function put(store: string, value: unknown): Promise<void> {
    const database = await open();
    const tx = database.transaction(store, "readwrite");
    tx.objectStore(store).put(value, "current");
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
  }
  async function remove(store: string): Promise<void> {
    const database = await open();
    const tx = database.transaction(store, "readwrite");
    tx.objectStore(store).delete("current");
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
  }

  async function quarantine(sealed: Uint8Array): Promise<void> {
    const database = await open();
    const tx = database.transaction("quarantine", "readwrite");
    const store = tx.objectStore("quarantine");
    const [keys, blobs] = await Promise.all([request(store.getAllKeys()), request(store.getAll() as IDBRequest<Uint8Array[]>)]);
    if (!blobs.some((b) => sameBytes(b, sealed))) {
      store.put(sealed, (keys.length ? Number(keys[keys.length - 1]) : 0) + 1);
      // The first stays; when full, the oldest after it goes.
      if (keys.length + 1 > QUARANTINE_KEEP) store.delete(keys[1]!);
    }
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
  }

  /** In one transaction: the snapshot (optionally) and the sync state's engine-side parts. */
  async function resetAnd(dropSnapshot: boolean): Promise<void> {
    const database = await open();
    const tx = database.transaction(["snapshot", "sync"], "readwrite");
    const done = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(tx.error ?? new Error("The write was aborted"));
    });
    const sync = tx.objectStore("sync");
    const read = sync.get("current") as IDBRequest<SyncState | undefined>;
    read.onsuccess = () => {
      if (read.result) sync.put(withoutEngineSide(read.result), "current");
    };
    if (dropSnapshot) tx.objectStore("snapshot").delete("current");
    await done;
  }

  return {
    loadKeys: () => get<Uint8Array>("device"),
    saveKeys: (bytes) => put("device", bytes),
    clearKeys: () => remove("device"),
    loadSnapshot: () => get<Uint8Array>("snapshot"),
    saveSnapshot: (b) => put("snapshot", b),
    clearSnapshot: () => resetAnd(true),
    resetEngineSide: () => resetAnd(false),
    loadWrapKey: () => get<CryptoKey>("wrap"),
    saveWrapKey: (k) => put("wrap", k),
    loadSyncState: () => get<SyncState>("sync"),
    saveSyncState: (st) => put("sync", st),
    loadIdentity: () => get<DeviceIdentity>("identity"),
    saveIdentity: (i) => put("identity", i),
    quarantineSnapshot: quarantine,
    loadQuarantine: async () => {
      const database = await open();
      return request(database.transaction("quarantine", "readonly").objectStore("quarantine").getAll() as IDBRequest<Uint8Array[]>);
    },
    replaceDevice: async (next) => {
      const database = await open();
      const names = [...database.objectStoreNames].filter((n) => n !== "session" || next.session !== undefined);
      const tx = database.transaction(names, "readwrite");
      const done = new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = tx.onabort = () => reject(tx.error ?? new Error("The write was aborted"));
      });
      try {
        for (const n of names) tx.objectStore(n).clear();
        tx.objectStore("device").put(next.keys, "current");
        if (next.wrapKey) tx.objectStore("wrap").put(next.wrapKey, "current");
        tx.objectStore("identity").put(next.identity, "current");
        if (next.snapshot) tx.objectStore("snapshot").put(next.snapshot, "current");
        if (next.sync) tx.objectStore("sync").put(next.sync, "current");
        next.quarantine?.forEach((blob, i) => tx.objectStore("quarantine").put(blob, i + 1));
        if (next.session) tx.objectStore("session").put(next.session, "current");
      } catch (error) {
        tx.abort(); // nothing written so far stays
        await done.catch(() => undefined);
        throw error;
      }
      await done;
    },
    clearDevice: async () => {
      await remove("device");
      await remove("snapshot");
      await remove("wrap");
      await remove("identity");
      await remove("sync");
      // The quarantine is sealed under the wrapping key just removed: nothing could open it again.
      const database = await open();
      const tx = database.transaction("quarantine", "readwrite");
      tx.objectStore("quarantine").clear();
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = tx.onabort = () => reject(tx.error);
      });
    },
    loadSession: () => get<StoredSession>("session"),
    saveSession: (s) => put("session", s),
    clearSession: () => remove("session"),
  };
}

/** Keeps everything for this visit only. Used where IndexedDB does not exist; nothing here is written to localStorage. */
export function createMemoryKeyStore(): KeyStore {
  let keys: Uint8Array | null = null;
  let snapshot: Uint8Array | null = null;
  let wrap: CryptoKey | null = null;
  let identity: DeviceIdentity | null = null;
  let sync: SyncState | null = null;
  const quarantined: Uint8Array[] = [];
  let session: StoredSession | null = null;
  return {
    loadKeys: async () => keys,
    saveKeys: async (b) => void (keys = b),
    clearKeys: async () => void (keys = null),
    loadSnapshot: async () => snapshot,
    saveSnapshot: async (b) => void (snapshot = b),
    clearSnapshot: async () => {
      snapshot = null;
      if (sync) sync = withoutEngineSide(sync);
    },
    resetEngineSide: async () => {
      if (sync) sync = withoutEngineSide(sync);
    },
    loadWrapKey: async () => wrap,
    saveWrapKey: async (k) => void (wrap = k),
    loadSyncState: async () => sync,
    saveSyncState: async (st) => void (sync = st),
    loadIdentity: async () => identity,
    saveIdentity: async (i) => void (identity = i),
    quarantineSnapshot: async (b) => {
      if (quarantined.some((q) => sameBytes(q, b))) return;
      quarantined.push(b);
      if (quarantined.length > QUARANTINE_KEEP) quarantined.splice(1, 1);
    },
    loadQuarantine: async () => [...quarantined],
    replaceDevice: async (next) => {
      keys = next.keys;
      snapshot = next.snapshot ?? null;
      wrap = next.wrapKey;
      identity = next.identity;
      sync = next.sync ?? null;
      quarantined.length = 0;
      quarantined.push(...(next.quarantine ?? []));
      if (next.session !== undefined) session = next.session;
    },
    clearDevice: async () => {
      keys = null;
      snapshot = null;
      wrap = null;
      identity = null;
      sync = null;
      quarantined.length = 0;
    },
    loadSession: async () => session,
    saveSession: async (s) => void (session = s),
    clearSession: async () => void (session = null),
  };
}

/** A key store that can fall back to memory for this tab: see `withMemoryFallback`. */
export interface FallbackKeyStore extends KeyStore {
  /** True while the keys, identity, session and engine state are held in this tab's memory only. */
  readonly inMemory: boolean;
  /** The store being wrapped. */
  readonly root: KeyStore;
  subscribe(listener: () => void): () => void;
  /** Tells `listener` whenever the sync state is saved. */
  subscribeSync(listener: () => void): () => void;
  /** From now on keep everything in memory, never in storage. Nothing already stored is touched. */
  holdInMemory(): void;
  /** Moves what is held in memory into storage, in one transaction for the device, and goes back to storage. Throws and stays in memory if storage still refuses. */
  moveToStorage(): Promise<void>;
}

/**
 * Wraps a store so that, when it refuses to keep a new account's keys, the tab can go on with them in memory only (so an approval from
 * this tab can still run), and move them into storage later if storage starts to work. Memory is gone when the tab closes, and
 * `clearDevice` (signing out) clears it and goes back to storage.
 */
export function withMemoryFallback(real: KeyStore, lock?: <T>(fn: () => Promise<T>) => Promise<T>): FallbackKeyStore {
  const memory = createMemoryKeyStore();
  let held = false;
  const listeners = new Set<() => void>();
  const syncListeners = new Set<() => void>();
  const set = (next: boolean) => {
    if (held === next) return;
    held = next;
    listeners.forEach((l) => l());
  };
  const own = {
    get inMemory() {
      return held;
    },
    root: real,
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    holdInMemory: () => set(true),
    subscribeSync: (l: () => void) => {
      syncListeners.add(l);
      return () => syncListeners.delete(l);
    },
    /** The sync state is saved here so a change tells the listeners at once (the guard on closing a memory-only tab). */
    saveSyncState: async (state: SyncState) => {
      await (held ? memory : real).saveSyncState(state);
      syncListeners.forEach((l) => l());
    },
    moveToStorage: async () => {
      // Under the engine's lock, so no action is half-way through while the device is carried over; one transaction, so a refusal
      // leaves nothing written and the tab stays in memory.
      await (lock ?? ((fn) => fn()))(async () => {
        const keys = await memory.loadKeys();
        const identity = await memory.loadIdentity();
        if (!keys || !identity) throw new Error("nothing_held");
        await real.replaceDevice({
          keys,
          wrapKey: await memory.loadWrapKey(),
          identity,
          snapshot: await memory.loadSnapshot(),
          sync: await memory.loadSyncState(),
          quarantine: await memory.loadQuarantine(),
          session: await memory.loadSession(),
        });
      });
      await memory.clearDevice();
      await memory.clearSession();
      set(false);
    },
    clearDevice: async () => {
      if (held) {
        await memory.clearDevice();
        await memory.clearSession();
        set(false);
        // Storage is left alone: the keys were written in one transaction or not at all, so nothing of this account is there, and
        // what is there may be another account's.
      } else await real.clearDevice();
    },
  };
  return new Proxy(own as unknown as FallbackKeyStore, {
    get(_target, prop) {
      if (prop in own) return Reflect.get(own, prop);
      const source = (held ? memory : real) as unknown as Record<string | symbol, unknown>;
      const value = source[prop];
      return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(source) : value;
    },
  });
}

export function defaultKeyStore(): KeyStore {
  return typeof indexedDB === "undefined" ? createMemoryKeyStore() : createIdbKeyStore();
}
