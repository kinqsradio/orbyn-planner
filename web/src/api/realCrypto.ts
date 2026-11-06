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
  // Read here, as a literal Vite replaces at build time, so a build without an engine address drops the
  // import below altogether and ships no module and no .wasm at all.
  if (!import.meta.env.VITE_ENGINE_URL || !configuredEngine()) return;
  try {
    registerAuthCrypto(await loadRealAuthCrypto());
  } catch {
    // Left unregistered: "Sign-in isn't available in this build yet".
  }
}
