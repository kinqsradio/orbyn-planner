import { configuredEngine } from "./feeds";
import { registerAuthCrypto, type AuthCrypto } from "./authCrypto";
import { loadWasmAuthCrypto, type OrbynWasmModule } from "./WasmAuthCrypto";

/**
 * The engine's real module, loaded only when it is needed. The import is dynamic, so Vite puts the
 * JavaScript glue and the `.wasm` file in chunks of their own that a page without accounts never
 * fetches. wasm-bindgen's `init()` then fetches the `.wasm` next to the glue (`new URL(..., import.meta.url)`).
 * The assignment to `OrbynWasmModule` makes the compiler check the real module against the names and
 * shapes the adapter uses.
 */
export function loadRealAuthCrypto(): Promise<AuthCrypto> {
  return loadWasmAuthCrypto(async () => {
    const module: OrbynWasmModule = await import("../generated/wasm/orbyn_wasm.js");
    return module;
  });
}

/**
 * Loads the module and registers it, if this build has an engine to sign in to (VITE_ENGINE_URL).
 * A build without one never imports it. A browser that can't run WebAssembly leaves sign-in
 * unavailable, which the screens already say; the planner itself keeps working.
 */
export async function ensureRealAuthCrypto(): Promise<void> {
  if (!import.meta.env.VITE_ENGINE_URL || !configuredEngine()) return;
  await attempt();
}

/** Where loading the module stands, for the screens that need it. "idle" is a build with no engine, which never loads it. */
export type CryptoLoad = "idle" | "loading" | "ready" | "failed";
let load: CryptoLoad = "idle";
/** How many loads have failed in a row. */
let failures = 0;
const listeners = new Set<() => void>();
const set = (next: CryptoLoad) => {
  load = next;
  listeners.forEach((l) => l());
};
/** Puts the state back to "idle". For tests. */
export function resetCryptoLoad(): void {
  failures = 0;
  set("idle");
}

export const cryptoLoad = {
  get: (): CryptoLoad => load,
  failures: (): number => failures,
  subscribe: (l: () => void) => {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

/** What loads the module; tests replace it to make the import fail or succeed. */
let loader: () => Promise<AuthCrypto> = loadRealAuthCrypto;
export function setCryptoLoader(next: () => Promise<AuthCrypto>): void {
  loader = next;
}

async function attempt(): Promise<void> {
  set("loading");
  try {
    registerAuthCrypto(await loader());
    failures = 0;
    set("ready");
  } catch {
    // Not a build without sign-in: the module itself would not load (a blocked request, a browser without WebAssembly).
    failures += 1;
    set("failed");
  }
}

/** Tries the import again, for the Retry button. */
export async function retryRealAuthCrypto(): Promise<void> {
  if (!import.meta.env.VITE_ENGINE_URL) return; // as above: a build without an engine address has no import to retry
  await attempt();
}
