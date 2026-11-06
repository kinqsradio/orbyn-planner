import "@fontsource-variable/geist/wght.css";
import "@fontsource/jetbrains-mono/400.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/app.css";
import { App } from "./app/App";
import { createAuthServices } from "./auth/services";
import { applyChoice, readStoredChoice, watchSystemTheme } from "./app/theme";

applyChoice(readStoredChoice());
watchSystemTheme();

// Accounts need the engine's WebAssembly module, which the build does not include yet: until it registers itself
// (registerAuthCrypto), sign-in says it is not available and the planner works on this device.
const auth = createAuthServices();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App auth={auth} />
  </StrictMode>,
);
