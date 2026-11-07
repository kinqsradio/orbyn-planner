import "@fontsource-variable/geist/wght.css";
import "@fontsource/jetbrains-mono/400.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/tokens.css";
import "./styles/app.css";
import { App } from "./app/App";
import { ensureRealAuthCrypto } from "./api/realCrypto";
import { createAuthServices } from "./auth/services";
import { applyChoice, readStoredChoice, watchSystemTheme } from "./app/theme";

applyChoice(readStoredChoice());
watchSystemTheme();

// Accounts run on the engine's WebAssembly module. A build with an engine address loads it (in a chunk of its
// own) before the first account screen; one without never fetches it, and sign-in says it is not available.
const auth = createAuthServices({ ready: ensureRealAuthCrypto() });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App auth={auth} />
  </StrictMode>,
);
