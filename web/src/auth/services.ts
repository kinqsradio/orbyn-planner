import { createAuthApi, type AuthApi } from "../api/auth";
import { requireAuthCrypto, type AuthCrypto } from "../api/authCrypto";
import { defaultKeyStore, type KeyStore } from "../api/keyStore";
import { TokenStore } from "../api/tokenStore";
import { wrapSecretFrom } from "../api/wrapSecret";
import { createEngineHost, type EngineHost, type Lock } from "./engineHost";

/** Everything the account screens use, so tests can swap the network, the storage and the crypto. */
export interface AuthServices {
  api: AuthApi;
  tokens: TokenStore;
  keys: KeyStore;
  /** The crypto to use now. In a build this refuses unless the real module registered itself. */
  crypto: () => AuthCrypto;
  /** The time in milliseconds; tests pin it. */
  now: () => number;
  /** The secret keys and the engine snapshot are sealed under. */
  wrapSecret: () => Promise<Uint8Array>;
  /** This device's sync engine, kept sealed in the key store. */
  engine: EngineHost;
  /** Tabs tell each other when one signs out, so the others drop their session too. */
  signedOut: { post(): void; listen(listener: () => void): () => void };
  /** How a waiting device or approver asks the server again: back off from `firstMs` to `maxMs`, give up after `totalMs`. */
  poll: PollSchedule;
}

export interface PollSchedule {
  firstMs: number;
  maxMs: number;
  totalMs: number;
}

/** Two seconds, slowing to ten, for up to ten minutes (an approval's life). */
export const DEFAULT_POLL: PollSchedule = { firstMs: 2000, maxMs: 10_000, totalMs: 600_000 };

export interface AuthServiceOptions {
  fetch?: typeof fetch;
  baseUrl?: string;
  keys?: KeyStore;
  crypto?: () => AuthCrypto;
  now?: () => number;
  poll?: PollSchedule;
  wrapSecret?: () => Promise<Uint8Array>;
  lock?: Lock;
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
  const crypto = options.crypto ?? requireAuthCrypto;
  const now = options.now ?? Date.now;
  const wrapSecret = options.wrapSecret ?? (() => wrapSecretFrom(keys));
  const engine = createEngineHost({ keys, crypto, wrapSecret, now, lock: options.lock });
  const channelName = "orbyn-planner-auth";
  const signedOut = {
    post: () => {
      try {
        const channel = new BroadcastChannel(channelName);
        channel.postMessage("signed-out");
        channel.close();
      } catch {
        // No BroadcastChannel: the other tabs find out on their next call.
      }
    },
    listen: (listener: () => void) => {
      if (typeof BroadcastChannel === "undefined") return () => undefined;
      const channel = new BroadcastChannel(channelName);
      channel.onmessage = (e: MessageEvent) => e.data === "signed-out" && listener();
      return () => channel.close();
    },
  };
  return { api, tokens, keys, crypto, now, poll: options.poll ?? DEFAULT_POLL, wrapSecret, engine, signedOut };
}
