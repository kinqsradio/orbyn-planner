import { IDBFactory } from "fake-indexeddb";
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { KEY_DB_NAME, createIdbKeyStore, createMemoryKeyStore, type StoredSession } from "./keyStore";
import { TokenStore } from "./tokenStore";

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
