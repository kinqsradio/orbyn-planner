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
      const req = factory.open(KEY_DB_NAME, 2);
      req.onupgradeneeded = () => {
        for (const name of ["device", "session", "snapshot", "wrap"]) {
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

  return {
    loadKeys: () => get<Uint8Array>("device"),
    saveKeys: (bytes) => put("device", bytes),
    clearKeys: () => remove("device"),
    loadSnapshot: () => get<Uint8Array>("snapshot"),
    saveSnapshot: (b) => put("snapshot", b),
    clearSnapshot: () => remove("snapshot"),
    loadWrapKey: () => get<CryptoKey>("wrap"),
    saveWrapKey: (k) => put("wrap", k),
    clearDevice: async () => {
      await remove("device");
      await remove("snapshot");
      await remove("wrap");
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
    clearDevice: async () => {
      keys = null;
      snapshot = null;
      wrap = null;
    },
    loadSession: async () => session,
    saveSession: async (s) => void (session = s),
    clearSession: async () => void (session = null),
  };
}

export function defaultKeyStore(): KeyStore {
  return typeof indexedDB === "undefined" ? createMemoryKeyStore() : createIdbKeyStore();
}
