import type { AuthCrypto, DeviceKeys, PendingLogin, PendingRegistration } from "./authCrypto";

/**
 * The shape of the module `wasm-bindgen --target web` makes from the engine's orbyn-wasm crate
 * (`pkg/orbyn_wasm.js`), as far as sign-in needs it. Its functions are the ones in AuthCrypto.
 */
export interface OrbynWasmModule {
  /** The initialiser wasm-bindgen exports; it fetches and compiles the `.wasm` file. */
  default?: (input?: unknown) => Promise<unknown>;
  startRegistration(password: Uint8Array): PendingRegistration;
  finishRegistration(pending: PendingRegistration, password: Uint8Array, response: Uint8Array): Uint8Array;
  startLogin(password: Uint8Array): PendingLogin;
  finishLogin(pending: PendingLogin, password: Uint8Array, response: Uint8Array): Uint8Array;
  DeviceKeys: {
    create(): DeviceKeys;
    import(bytes: Uint8Array): DeviceKeys;
  };
  normalizeEmail(email: string): string | undefined;
}

/** AuthCrypto over a loaded module: every call goes straight to the module's function of the same name. */
export function wasmAuthCrypto(module: OrbynWasmModule): AuthCrypto {
  return {
    startRegistration: (password) => module.startRegistration(password),
    finishRegistration: (pending, password, response) => module.finishRegistration(pending, password, response),
    startLogin: (password) => module.startLogin(password),
    finishLogin: (pending, password, response) => module.finishLogin(pending, password, response),
    deviceKeys: {
      create: () => module.DeviceKeys.create(),
      import: (bytes) => module.DeviceKeys.import(bytes),
    },
    normalizeEmail: (email) => module.normalizeEmail(email),
  };
}

/**
 * Loads the module with the given loader and wraps it. Nothing calls this yet: the build has no
 * WebAssembly step. When it does, the entry point registers it with a dynamic import:
 *
 *     registerAuthCrypto(await loadWasmAuthCrypto(() => import("orbyn-wasm")));
 */
export async function loadWasmAuthCrypto(load: () => Promise<OrbynWasmModule>): Promise<AuthCrypto> {
  const module = await load();
  await module.default?.();
  return wasmAuthCrypto(module);
}
