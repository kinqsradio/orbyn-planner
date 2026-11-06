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

/** The account and device the stored keys belong to. */
export interface DeviceIdentity {
  accountId: string;
  deviceId: string;
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
  /** Keeps a snapshot that could not be read, sealed as it was, so it isn't lost. At most `QUARANTINE_KEEP`, newest last. */
  quarantineSnapshot(sealed: Uint8Array): Promise<void>;
  loadQuarantine(): Promise<Uint8Array[]>;
  /** The non-extractable WebCrypto key the wrapping secret comes from. It can be stored but not read. */
  loadWrapKey(): Promise<CryptoKey | null>;
  saveWrapKey(key: CryptoKey): Promise<void>;
  /** Forgets this device: keys, snapshot and wrapping key together (the snapshot is bound to the keys). */
  clearDevice(): Promise<void>;
  loadSession(): Promise<StoredSession | null>;
  saveSession(session: StoredSession): Promise<void>;
  clearSession(): Promise<void>;
}

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
      const req = factory.open(KEY_DB_NAME, 3);
      req.onupgradeneeded = () => {
        for (const name of ["device", "session", "snapshot", "wrap", "identity", "quarantine"]) {
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
    // Keys are increasing numbers, so the oldest are the lowest; keep the newest few.
    const keys = await request(store.getAllKeys());
    store.put(sealed, (keys.length ? Number(keys[keys.length - 1]) : 0) + 1);
    for (const k of keys.slice(0, Math.max(keys.length + 1 - QUARANTINE_KEEP, 0))) store.delete(k);
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
    loadIdentity: () => get<DeviceIdentity>("identity"),
    saveIdentity: (i) => put("identity", i),
    quarantineSnapshot: quarantine,
    loadQuarantine: async () => {
      const database = await open();
      return request(database.transaction("quarantine", "readonly").objectStore("quarantine").getAll() as IDBRequest<Uint8Array[]>);
    },
    clearDevice: async () => {
      // The quarantine stays: it is what a person could still recover.
      await remove("device");
      await remove("snapshot");
      await remove("wrap");
      await remove("identity");
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
    loadIdentity: async () => identity,
    saveIdentity: async (i) => void (identity = i),
    quarantineSnapshot: async (b) => {
      quarantined.push(b);
      while (quarantined.length > QUARANTINE_KEEP) quarantined.shift();
    },
    loadQuarantine: async () => [...quarantined],
    clearDevice: async () => {
      keys = null;
      snapshot = null;
      wrap = null;
      identity = null;
    },
    loadSession: async () => session,
    saveSession: async (s) => void (session = s),
    clearSession: async () => void (session = null),
  };
}

export function defaultKeyStore(): KeyStore {
  return typeof indexedDB === "undefined" ? createMemoryKeyStore() : createIdbKeyStore();
}
