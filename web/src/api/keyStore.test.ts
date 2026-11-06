import { IDBFactory } from "fake-indexeddb";
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { KEY_DB_NAME, createIdbKeyStore, createMemoryKeyStore, type StoredSession } from "./keyStore";
import { TokenStore } from "./tokenStore";
import { wrapSecretFrom } from "./wrapSecret";

const session: StoredSession = {
  token: "secret-token",
  accountId: "a",
  deviceId: "d",
  deviceState: "trusted",
  expiresAt: "2030-01-01T00:00:00.000Z",
  email: "sam@example.com",
  name: "Sam",
};

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  localStorage.clear();
  sessionStorage.clear();
});

describe("the key store", () => {
  it("keeps keys and the session in a database of its own", async () => {
    const store = createIdbKeyStore();
    await store.saveKeys(new Uint8Array([1, 2, 3]));
    await store.saveSession(session);
    expect(KEY_DB_NAME).toBe("orbyn-planner-keys");
    const names = (await indexedDB.databases()).map((d) => d.name);
    expect(names).toEqual(["orbyn-planner-keys"]); // not the planner's own database
    // A second store on the same database reads them back.
    const again = createIdbKeyStore();
    expect(Array.from((await again.loadKeys())!)).toEqual([1, 2, 3]);
    expect(await again.loadSession()).toEqual(session);
  });

  it("never writes to localStorage or sessionStorage", async () => {
    const store = createIdbKeyStore();
    await store.saveKeys(new Uint8Array([9]));
    await store.saveSession(session);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    const memory = createMemoryKeyStore();
    await memory.saveSession(session);
    expect(localStorage.length).toBe(0);
  });

  it("clears them separately", async () => {
    const store = createIdbKeyStore();
    await store.saveKeys(new Uint8Array([1]));
    await store.saveSession(session);
    await store.clearSession();
    expect(await store.loadSession()).toBeNull();
    expect(await store.loadKeys()).not.toBeNull();
    await store.clearKeys();
    expect(await store.loadKeys()).toBeNull();
  });
});

describe("forgetting a device in IndexedDB", () => {
  it("removes the keys, the snapshot, the wrapping key, the identity and the quarantine together", async () => {
    const store = createIdbKeyStore();
    const wrap = await crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    await store.saveKeys(new Uint8Array([1]));
    await store.saveSnapshot(new Uint8Array([2]));
    await store.saveWrapKey(wrap);
    await store.saveIdentity({ accountId: "a", deviceId: "d" });
    await store.quarantineSnapshot(new Uint8Array([3]));
    expect(await store.loadWrapKey()).not.toBeNull();
    await createIdbKeyStore().clearDevice(); // another store object on the same database
    expect(await store.loadKeys()).toBeNull();
    expect(await store.loadSnapshot()).toBeNull();
    expect(await store.loadWrapKey()).toBeNull();
    expect(await store.loadIdentity()).toBeNull();
    expect(await store.loadQuarantine()).toEqual([]); // it was sealed under the wrapping key just removed
  });

  it("pins the first unreadable snapshot and keeps the newest after it", async () => {
    const store = createIdbKeyStore();
    for (let i = 1; i <= 5; i++) await store.quarantineSnapshot(new Uint8Array([i]));
    expect((await store.loadQuarantine()).map((b) => b[0])).toEqual([1, 4, 5]);
  });

  it("does not keep the same unreadable snapshot twice, so repeated failures can't push the original out", async () => {
    const store = createIdbKeyStore();
    await store.quarantineSnapshot(new Uint8Array([7]));
    for (let i = 0; i < 10; i++) await store.quarantineSnapshot(new Uint8Array([8]));
    for (let i = 0; i < 10; i++) await store.quarantineSnapshot(new Uint8Array([8]));
    expect((await store.loadQuarantine()).map((b) => b[0])).toEqual([7, 8]);
  });

  it("the wrapping secret comes from a key that is stored but never readable", async () => {
    const store = createIdbKeyStore();
    const a = await wrapSecretFrom(store);
    const b = await wrapSecretFrom(createIdbKeyStore());
    expect(a).toHaveLength(32);
    expect(Array.from(b)).toEqual(Array.from(a)); // the same stored key gives the same secret
    expect((await store.loadWrapKey())!.extractable).toBe(false);
    await store.clearDevice();
    expect(Array.from(await wrapSecretFrom(store))).not.toEqual(Array.from(a)); // a new key after forgetting
  });
});

describe("the token store", () => {
  it("holds the token in memory and in IndexedDB, and forgets it on clear", async () => {
    const keys = createIdbKeyStore();
    const tokens = new TokenStore(keys);
    expect(tokens.token()).toBeNull();
    await tokens.set(session);
    expect(tokens.token()).toBe("secret-token");
    // A new page load finds it again.
    const reloaded = new TokenStore(createIdbKeyStore());
    expect((await reloaded.load(Date.parse("2026-11-07")))?.token).toBe("secret-token");
    await tokens.clear();
    expect(tokens.token()).toBeNull();
    expect(await createIdbKeyStore().loadSession()).toBeNull();
  });

  it("drops a session that has expired", async () => {
    const keys = createIdbKeyStore();
    await keys.saveSession({ ...session, expiresAt: "2026-01-01T00:00:00.000Z" });
    const tokens = new TokenStore(keys);
    expect(await tokens.load(Date.parse("2026-11-07"))).toBeNull();
    expect(await keys.loadSession()).toBeNull();
  });

  it("tells listeners when the session changes", async () => {
    const tokens = new TokenStore(createMemoryKeyStore());
    let calls = 0;
    tokens.subscribe(() => calls++);
    await tokens.set(session);
    await tokens.update({ deviceState: "pending" });
    expect(tokens.getSession()?.deviceState).toBe("pending");
    await tokens.clear();
    expect(calls).toBe(3);
  });
});
