import type { KeyStore } from "./keyStore";

const LABEL = "orbyn/local-wrap/v1";

/**
 * The wrapping secret orbyn-wasm seals the device keys and the engine snapshot under (its README,
 * "Secrets stay inside WebAssembly"): the MAC of a fixed label under a non-extractable HMAC key. The
 * key is made once per device and kept in IndexedDB, where it can be used but never read, so the
 * stored bytes are useless without this browser's key.
 */
export async function wrapSecretFrom(store: KeyStore, subtle: SubtleCrypto = globalThis.crypto.subtle): Promise<Uint8Array> {
  let key = await store.loadWrapKey();
  if (!key) {
    key = await subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    await store.saveWrapKey(key);
  }
  return new Uint8Array(await subtle.sign("HMAC", key, new TextEncoder().encode(LABEL)));
}

/**
 * A new wrapping key and the secret it gives, made but not stored: for replacing a device's keys in one
 * transaction, where the new key is stored with them or not at all.
 */
export async function freshWrapSecret(subtle: SubtleCrypto = globalThis.crypto.subtle): Promise<{ key: CryptoKey; secret: Uint8Array }> {
  const key = await subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return { key, secret: new Uint8Array(await subtle.sign("HMAC", key, new TextEncoder().encode(LABEL))) };
}
