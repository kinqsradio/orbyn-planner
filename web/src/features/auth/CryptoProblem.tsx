import { useSyncExternalStore } from "react";
import { cryptoLoad, retryRealAuthCrypto } from "../../api/realCrypto";

export const MODULE_LOAD_FAILED = "Couldn’t load Orbyn’s security module";

/**
 * Shown where sign-in is offered when the engine's module failed to load (a blocked request, a browser
 * without WebAssembly). That is not the same as a build with no sign-in, which says so plainly instead.
 * After a Retry fails too, the page itself is offered: some browsers remember that an import failed, and
 * only a reload tries it again.
 */
export function CryptoProblem({ onReload = () => window.location.reload() }: { onReload?: () => void }) {
  const state = useSyncExternalStore(cryptoLoad.subscribe, cryptoLoad.get);
  const failures = useSyncExternalStore(cryptoLoad.subscribe, cryptoLoad.failures);
  if (state !== "failed") return null;
  return (
    <p className="err" role="alert">
      {MODULE_LOAD_FAILED}.{" "}
      <button type="button" className="link-btn" onClick={() => void retryRealAuthCrypto()}>Retry</button>
      {failures >= 2 && (
        <>
          {" "}
          <button type="button" className="link-btn" onClick={onReload}>Reload the page</button>
        </>
      )}
    </p>
  );
}
