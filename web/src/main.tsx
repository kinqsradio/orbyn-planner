import "@fontsource-variable/geist/wght.css";
import "@fontsource/jetbrains-mono/400.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/app.css";
import { App } from "./app/App";
import { applyChoice, readStoredChoice, watchSystemTheme } from "./app/theme";

applyChoice(readStoredChoice());
watchSystemTheme();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
