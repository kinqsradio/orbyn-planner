import { createAuthApi, type AuthApi } from "../api/auth";
import { requireAuthCrypto, type AuthCrypto } from "../api/authCrypto";
import { defaultKeyStore, type KeyStore } from "../api/keyStore";
import { TokenStore } from "../api/tokenStore";

/** Everything the account screens use, so tests can swap the network, the storage and the crypto. */
export interface AuthServices {
  api: AuthApi;
  tokens: TokenStore;
  keys: KeyStore;
  /** The crypto to use now. In a build this refuses unless the real module registered itself. */
  crypto: () => AuthCrypto;
  /** The time in milliseconds; tests pin it. */
  now: () => number;
}

export interface AuthServiceOptions {
  fetch?: typeof fetch;
  baseUrl?: string;
  keys?: KeyStore;
  crypto?: () => AuthCrypto;
  now?: () => number;
}

export function createAuthServices(options: AuthServiceOptions = {}): AuthServices {
  const keys = options.keys ?? defaultKeyStore();
  const tokens = new TokenStore(keys);
  const api = createAuthApi({
    fetch: options.fetch,
    baseUrl: options.baseUrl,
    token: tokens.token,
    // A 401 on a signed-in call: the session is over, so forget the token.
    onUnauthorized: () => void tokens.clear(),
  });
  return { api, tokens, keys, crypto: options.crypto ?? requireAuthCrypto, now: options.now ?? Date.now };
}
