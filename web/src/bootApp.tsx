import { StrictMode } from "react";
import type { Root } from "react-dom/client";
import { ensureRealAuthCrypto } from "./api/realCrypto";
import { App } from "./app/App";
import { createAuthServices } from "./auth/services";

/** Starts the planner with accounts. Loaded only for the planner's own pages, never for the page behind the deletion email's link. */
export function bootApp(root: Root): void {
  // Accounts run on the engine's WebAssembly module. A build with an engine address loads it (in a chunk of its
  // own) before the first account screen; one without never fetches it, and sign-in says it is not available.
  const auth = createAuthServices({ ready: ensureRealAuthCrypto() });
  root.render(
    <StrictMode>
      <App auth={auth} />
    </StrictMode>,
  );
}
