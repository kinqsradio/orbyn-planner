import { createMemoryKeyStore, type KeyStore, type StoredSession } from "../../api/keyStore";
import { realAuthCrypto } from "../../api/testing/realModule";
import { signIn } from "../../auth/flows";
import { signUpVerified } from "./mailbox";
import { ApproverController, DeviceController } from "../../auth/pairing";
import { createAuthServices, type AuthServices } from "../../auth/services";
import { LocalStore } from "../../store/LocalStore";
import { MemoryPersistence } from "../../store/persistence";

export const engineUrl = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.ORBYN_E2E_ENGINE;

export async function until(what: string, check: () => boolean, ms = 20_000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

export interface Browser {
  services: AuthServices;
  keys: KeyStore;
  persistence: MemoryPersistence;
  store: LocalStore;
  session: StoredSession;
}

/** One browser with the real module, its own key store and an empty planner. */
export async function browser(): Promise<Omit<Browser, "session">> {
  const crypto = realAuthCrypto();
  const keys = createMemoryKeyStore();
  const wrap = globalThis.crypto.getRandomValues(new Uint8Array(32));
  const services = createAuthServices({ baseUrl: engineUrl, keys, crypto: () => crypto, wrapSecret: async () => wrap.slice(), poll: { firstMs: 30, maxMs: 150, totalMs: 20_000 } });
  const persistence = new MemoryPersistence();
  const store = new LocalStore({ persistence, broadcast: false });
  await store.ready;
  return { services, keys, persistence, store };
}

/** Signs up on one browser, signs in on another, and pairs them with the digits compared; both end trusted. */
export async function pairedBrowsers(email: string, password = "correct horse battery staple"): Promise<{ a: Browser; b: Browser }> {
  const a = await browser();
  const b = await browser();
  const first = await signUpVerified(a.services, { name: "Sam", email, password });
  const second = await signIn(b.services, { email, password });
  const pending = (await a.services.api.devices()).devices.find((x) => x.id === second.deviceId)!;
  const approver = new ApproverController(a.services, first, pending);
  const device = new DeviceController(b.services, second);
  void approver.start();
  void device.run();
  await until("both to show the digits", () => approver.getState().phase === "compare" && device.getState().phase === "compare");
  const onA = approver.getState();
  const onD = device.getState();
  if (onA.phase !== "compare" || onD.phase !== "compare" || onA.sas !== onD.sas) throw new Error("the digits differ");
  void approver.confirm();
  await until("the approver to wait", () => approver.getState().phase === "finishing");
  device.confirm();
  await until("both to finish", () => approver.getState().phase === "done" && device.getState().phase === "trusted");
  await device.continue();
  device.dispose();
  approver.dispose();
  return { a: { ...a, session: first }, b: { ...b, session: b.services.tokens.getSession()! } };
}
