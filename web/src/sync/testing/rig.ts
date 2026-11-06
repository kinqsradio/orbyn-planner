import { createMemoryKeyStore, type KeyStore, type StoredSession } from "../../api/keyStore";
import { realAuthCrypto } from "../../api/testing/realModule";
import { createMockEngine, type MockEngine } from "../../api/testing/MockEngine";
import type { Device } from "../../generated/Device";
import { createAuthServices, type AuthServices } from "../../auth/services";
import { LocalStore } from "../../store/LocalStore";
import { MemoryPersistence } from "../../store/persistence";

const ACCOUNT = "00000000-0000-4000-8000-0000000000a1";

export interface TestDevice {
  id: string;
  services: AuthServices;
  session: StoredSession;
  keys: KeyStore;
  persistence: MemoryPersistence;
  store: LocalStore;
  device: Device;
}

export interface SyncRig {
  engine: MockEngine;
  a: TestDevice;
  b: TestDevice;
  /** Moves the clock every device and the server share. */
  clock: { now: number };
  /** Another store over the same stored data: what a reload of the device shows. */
  reload(d: TestDevice): Promise<LocalStore>;
  /** Makes the network refuse (a thrown fetch) while `down` is true. */
  network: { down: boolean; /** The next upload reaches the server but its answer is lost. */ loseAnswer: boolean };
}

/** Two trusted devices of one account on the mock server, with the real module and each pinning the other. Tests only. */
export async function createSyncRig(): Promise<SyncRig> {
  const crypto = realAuthCrypto();
  const clock = { now: Date.UTC(2026, 10, 7, 10, 0, 0) };
  const network = { down: false, loseAnswer: false };
  const engine = createMockEngine(() => clock.now);
  const fetchFn = (async (url: string, init?: RequestInit) => {
    if (network.down) throw new TypeError("Failed to fetch");
    if (network.loseAnswer && init?.method === "POST" && String(url).endsWith("/changes")) {
      network.loseAnswer = false;
      await engine.fetch(url, init);
      throw new TypeError("Failed to fetch");
    }
    return engine.fetch(url, init);
  }) as typeof fetch;

  const make = async (n: number): Promise<TestDevice> => {
    const id = `00000000-0000-4000-8000-0000000000${n}${n}`;
    const keys = createMemoryKeyStore();
    const wrap = Uint8Array.from({ length: 32 }, (_, i) => (i * 5 + n) % 256);
    const material = crypto.deviceKeys.create();
    await keys.saveKeys(material.export(wrap));
    const services = createAuthServices({ fetch: fetchFn, baseUrl: "http://engine.test", keys, crypto: () => crypto, now: () => clock.now, wrapSecret: async () => wrap.slice(), poll: { firstMs: 5, maxMs: 15, totalMs: 4000 } });
    const device: Device = {
      id, name: n === 1 ? "A" : "B", platform: "web", state: "trusted", signing_key: material.signingKey(), agreement_key: material.agreementKey(),
      created_at: new Date(clock.now).toISOString(), approved_by: null, approval_signature: null, current: false,
    };
    const session: StoredSession = { token: `tok-${n}`, accountId: ACCOUNT, deviceId: id, deviceState: "trusted", expiresAt: "2030-01-01T00:00:00Z", email: "s@example.com", name: "" };
    await services.tokens.set(session);
    await keys.saveIdentity({ accountId: ACCOUNT, deviceId: id, email: "s@example.com" });
    const persistence = new MemoryPersistence();
    const store = new LocalStore({ persistence, now: () => new Date(clock.now), broadcast: false });
    await store.ready;
    material.free();
    return { id, services, session, keys, persistence, store, device };
  };

  const a = await make(1);
  const b = await make(2);
  engine.accounts.set("s@example.com", { id: ACCOUNT, email: "s@example.com", verifier: new Uint8Array(32), devices: [a.device, b.device] });
  engine.sessions.set("tok-1", { accountId: ACCOUNT, deviceId: a.id });
  engine.sessions.set("tok-2", { accountId: ACCOUNT, deviceId: b.id });
  // Each device trusts the other, as it would have after the two-way comparison.
  for (const [me, other] of [[a, b], [b, a]] as const) {
    await me.services.engine.run(me.session, (e) => e.sync?.pinDevice(other.id, other.device.signing_key, other.device.agreement_key));
  }
  return {
    engine,
    a,
    b,
    clock,
    network,
    reload: async (d) => {
      const store = new LocalStore({ persistence: d.persistence, now: () => new Date(clock.now), broadcast: false });
      await store.ready;
      return store;
    },
  };
}
