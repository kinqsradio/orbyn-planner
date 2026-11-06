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
  /** The trusted devices the zone keys were last sent to (sorted ids joined), so a new device gets them. */
  keysFor: string;
  /** Ids of the records the engine could not open yet, by zone, for Settings. */
  quarantined: Record<string, string[]>;
  /** ISO time of the last complete sync. */
  lastSyncedAt: string | null;
}

export const emptySyncState = (): SyncState => ({ zones: [], zoneOf: {}, staged: {}, stagedZone: {}, keysFor: "", quarantined: {}, lastSyncedAt: null });

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
  clearSnapshot(): Promise<void>;
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
  loadSession(): Promise<StoredSession | null>;
  saveSession(session: StoredSession): Promise<void>;
  clearSession(): Promise<void>;
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

  return {
    loadKeys: () => get<Uint8Array>("device"),
    saveKeys: (bytes) => put("device", bytes),
    clearKeys: () => remove("device"),
    loadSnapshot: () => get<Uint8Array>("snapshot"),
    saveSnapshot: (b) => put("snapshot", b),
    clearSnapshot: () => remove("snapshot"),
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
    clearSnapshot: async () => void (snapshot = null),
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

export function defaultKeyStore(): KeyStore {
  return typeof indexedDB === "undefined" ? createMemoryKeyStore() : createIdbKeyStore();
}
