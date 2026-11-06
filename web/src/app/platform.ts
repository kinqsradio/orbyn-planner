/** Where the app is running: in a browser, or inside the Tauri desktop shell. */
export type Platform = "web" | "desktop";

/**
 * Tauri puts `__TAURI_INTERNALS__` on `window` before the page runs. That is the test, not the user
 * agent, which a browser can send and a webview does not announce. The planner is the same app on
 * both; this exists only so the web page can hide the hint to install the desktop app.
 */
export function detectPlatform(target: object = typeof window === "undefined" ? {} : window): Platform {
  return "__TAURI_INTERNALS__" in target ? "desktop" : "web";
}

export const isDesktop = (): boolean => detectPlatform() === "desktop";
