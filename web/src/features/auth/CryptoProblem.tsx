import { useSyncExternalStore } from "react";
import { cryptoLoad, retryRealAuthCrypto } from "../../api/realCrypto";

export const MODULE_LOAD_FAILED = "Couldn’t load Orbyn’s security module";

/**
 * Shown where sign-in is offered when the engine's module failed to load (a blocked request, a browser
 * without WebAssembly). That is not the same as a build with no sign-in, which says so plainly instead.
 */
export function CryptoProblem() {
  const state = useSyncExternalStore(cryptoLoad.subscribe, cryptoLoad.get);
  if (state !== "failed") return null;
  return (
    <p className="err" role="alert">
      {MODULE_LOAD_FAILED}.{" "}
      <button type="button" className="link-btn" onClick={() => void retryRealAuthCrypto()}>Retry</button>
    </p>
  );
}
