import "@fontsource-variable/geist/wght.css";
import "@fontsource/jetbrains-mono/400.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/tokens.css";
import "./styles/app.css";
import { applyChoice, readStoredChoice, watchSystemTheme } from "./app/theme";

applyChoice(readStoredChoice());
watchSystemTheme();

const root = createRoot(document.getElementById("root")!);

async function start() {
  // The link in the account-deletion email opens a page of its own, before the app: no sign-in, no planner, no stores, and the
  // engine's module is never started. Nothing below is even loaded for it.
  if (window.location.pathname === "/cancel-deletion") {
    const { CancelDeletionPage } = await import("./features/auth/CancelDeletionPage");
    root.render(
      <StrictMode>
        <CancelDeletionPage />
      </StrictMode>,
    );
    return;
  }
  const { bootApp } = await import("./bootApp");
  bootApp(root);
}

void start();
