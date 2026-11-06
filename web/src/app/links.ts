import { useEffect } from "react";
import { isDesktop } from "./platform";

/** The web addresses in a piece of text, without the punctuation that ends a sentence. Only http and https. */
export function linksIn(text: string): string[] {
  const found = text.match(/https?:\/\/[^\s<>"']+/gi) ?? [];
  const clean = found.map((u) => u.replace(/[.,;:!?)\]}]+$/, "")).filter((u) => isWebAddress(u));
  return [...new Set(clean)];
}

/** Whether this is a plain http(s) address, the only kind the app opens outside itself. */
export function isWebAddress(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && url.username === "" && url.password === "";
  } catch {
    return false;
  }
}

interface Internals {
  invoke: (command: string, args: Record<string, unknown>) => Promise<unknown>;
}

/**
 * Opens a link outside the app. The desktop window may not navigate away, so the shell's one
 * command, `open_link`, hands it to the system browser; a browser opens a tab. Anything that is not
 * an http(s) address is ignored here and refused again by the shell.
 */
export function openExternal(url: string): void {
  if (!isWebAddress(url)) return;
  if (isDesktop()) {
    const internals = (window as unknown as { __TAURI_INTERNALS__?: Internals }).__TAURI_INTERNALS__;
    void internals?.invoke("open_link", { url })?.catch(() => undefined);
  } else {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

/**
 * Sends a click on a web link to the system browser, never the window. A primary click and a
 * middle click (`auxclick`, button 1) both do; the right button is left to the context menu.
 */
export function openLinkFromEvent(e: MouseEvent): void {
  if (e.button !== 0 && e.button !== 1) return;
  const a = (e.target as Element | null)?.closest?.("a[href]");
  const href = a?.getAttribute("href");
  if (!href || !isWebAddress(href)) return;
  e.preventDefault();
  openExternal(href);
}

/** Listens for link clicks on the document; returns the function that stops listening. */
export function listenForExternalLinks(): () => void {
  document.addEventListener("click", openLinkFromEvent);
  // A middle click does not fire "click" in a browser or a webview; without this it would open
  // the link in a new window of the shell.
  document.addEventListener("auxclick", openLinkFromEvent);
  return () => {
    document.removeEventListener("click", openLinkFromEvent);
    document.removeEventListener("auxclick", openLinkFromEvent);
  };
}

/** In the desktop app, a click on a web link anywhere opens it in the system browser, never in the window. */
export function useExternalLinks(): void {
  useEffect(() => {
    if (!isDesktop()) return;
    return listenForExternalLinks();
  }, []);
}
