import type { ApprovalEngine, AuthCrypto } from "../../api/authCrypto";
import { createMemoryKeyStore, type KeyStore, type StoredSession } from "../../api/keyStore";
import { FakeAuthCrypto } from "../../api/testing/FakeAuthCrypto";
import { createMockEngine, type MockEngine } from "../../api/testing/MockEngine";
import type { Device } from "../../generated/Device";
import { createAuthServices, type AuthServices } from "../services";

/** Two devices of one account on a mock server, for tests of the pairing controllers. Tests only. */
export const FAST = { firstMs: 5, maxMs: 15, totalMs: 4000 };
const ACCOUNT = "00000000-0000-4000-8000-0000000000a1";
const ID_A = "00000000-0000-4000-8000-0000000000a2";
const ID_D = "00000000-0000-4000-8000-0000000000d2";

export interface Rig {
  engine: MockEngine;
  counts: { confirm: number; finish: number; sign: number };
  a: { services: AuthServices; session: StoredSession; device: Device; keys: KeyStore };
  d: { services: AuthServices; session: StoredSession; device: Device; keys: KeyStore };
  /** More services over the new device's keys and session: another tab of it. */
  tabOfD: () => Promise<AuthServices>;
  fail: { save: boolean };
  delay: { devices: number };
}

export async function createRig(options: { newDeviceState?: "pending" | "trusted"; slowDevices?: number } = {}): Promise<Rig> {
  const fake = new FakeAuthCrypto();
  const counts = { confirm: 0, finish: 0, sign: 0 };
  const wrapEngine = (e: ApprovalEngine): ApprovalEngine => ({
    ...e,
    confirmApproval: (...args) => {
      counts.confirm += 1;
      counts.sign += 1; // confirming is what signs
      return e.confirmApproval(...args);
    },
    finishApproval: (...args) => {
      counts.finish += 1;
      return e.finishApproval(...args);
    },
  });
  const crypto: AuthCrypto = Object.assign(Object.create(fake) as AuthCrypto, {
    engine: {
      create: (...args: Parameters<AuthCrypto["engine"]["create"]>) => wrapEngine(fake.engine.create(...args)),
      restore: (...args: Parameters<AuthCrypto["engine"]["restore"]>) => wrapEngine(fake.engine.restore(...args)),
    },
  });
  const engine = createMockEngine();
  const fail = { save: false };
  const delay = { devices: options.slowDevices ?? 0 };

  const keyStore = (): KeyStore => {
    const k = createMemoryKeyStore();
    const saveSnapshot = k.saveSnapshot;
    return {
      ...k,
      saveSnapshot: async (b) => {
        if (fail.save) throw new Error("quota exceeded");
        return saveSnapshot(b);
      },
    };
  };
  const wrapOf = new WeakMap<KeyStore, Uint8Array>();
  const build = (keys: KeyStore): AuthServices => {
    if (!wrapOf.has(keys)) wrapOf.set(keys, Uint8Array.from({ length: 32 }, (_, i) => (i * 7 + 3) % 256));
    return createAuthServices({
      keys,
      crypto: () => crypto,
      poll: FAST,
      baseUrl: "http://engine.test",
      wrapSecret: async () => wrapOf.get(keys)!.slice(),
      fetch: (async (url: string, init?: RequestInit) => {
        if (delay.devices && /\/v1\/devices$/.test(String(url)) && (init?.method ?? "GET") === "GET") await new Promise((r) => setTimeout(r, delay.devices));
        return engine.fetch(url, init);
      }) as typeof fetch,
    });
  };

  const make = async (id: string, state: "pending" | "trusted", token: string) => {
    const keys = keyStore();
    const material = crypto.deviceKeys.create();
    const wrap = Uint8Array.from({ length: 32 }, (_, i) => (i * 7 + 3) % 256);
    await keys.saveKeys(material.export(wrap));
    const device: Device = {
      id, name: id === ID_A ? "Laptop" : "Phone", platform: "web", state, signing_key: material.signingKey(), agreement_key: material.agreementKey(),
      created_at: "2026-11-07T10:00:00Z", approved_by: null, approval_signature: null, current: false,
    };
    const session: StoredSession = { token, accountId: ACCOUNT, deviceId: id, deviceState: state, expiresAt: "2030-01-01T00:00:00Z", email: "a@b.co", name: "" };
    const services = build(keys);
    await services.tokens.set(session);
    await keys.saveIdentity({ accountId: ACCOUNT, deviceId: id });
    return { services, session, device, keys };
  };

  const a = await make(ID_A, "trusted", "tok-a");
  const d = await make(ID_D, options.newDeviceState ?? "pending", "tok-d");
  engine.accounts.set("a@b.co", { id: ACCOUNT, email: "a@b.co", verifier: new Uint8Array(32), devices: [a.device, d.device] });
  engine.sessions.set("tok-a", { accountId: ACCOUNT, deviceId: ID_A });
  engine.sessions.set("tok-d", { accountId: ACCOUNT, deviceId: ID_D });
  return { engine, counts, a, d, fail, delay, tabOfD: async () => {
      const tab = build(d.keys);
      await tab.tokens.set(d.session);
      return tab;
    },
  };
}

export const calls = (r: Rig, suffix: string) => r.engine.calls.filter((c) => c.method === "POST" && c.path.endsWith(suffix));

export async function until(check: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 5));
  }
}
