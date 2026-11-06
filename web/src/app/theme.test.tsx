import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import html from "../../index.html?raw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PrefsProvider } from "./prefs";
import { SettingsPage } from "../features/settings/SettingsPage";
import { applyChoice, chooseTheme, readStoredChoice, THEME_KEY, watchSystemTheme } from "./theme";

function stubSystem(dark: boolean) {
  let listener: (() => void) | undefined;
  const query = {
    get matches() {
      return dark;
    },
    addEventListener: (_: string, l: () => void) => (listener = l),
    removeEventListener: () => (listener = undefined),
  };
  vi.stubGlobal("matchMedia", () => query);
  return {
    flip() {
      dark = !dark;
      listener?.();
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("theme", () => {
  it("persists the choice and sets data-theme", async () => {
    stubSystem(false);
    render(<PrefsProvider><SettingsPage /></PrefsProvider>);
    await userEvent.click(screen.getByRole("radio", { name: "Dim" }));
    expect(document.documentElement.dataset.theme).toBe("dim");
    expect(localStorage.getItem(THEME_KEY)).toBe("dim");
    expect(screen.getByRole("radio", { name: "Dim" })).toBeChecked();
  });

  it("defaults to the system and ignores junk in storage", () => {
    stubSystem(true);
    expect(readStoredChoice()).toBe("system");
    localStorage.setItem(THEME_KEY, "neon");
    expect(readStoredChoice()).toBe("system");
    applyChoice(readStoredChoice());
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("System follows the operating system while it is chosen", async () => {
    const system = stubSystem(false);
    const stop = watchSystemTheme();
    chooseTheme("system");
    expect(document.documentElement.dataset.theme).toBe("light");
    act(() => system.flip());
    expect(document.documentElement.dataset.theme).toBe("dark");
    chooseTheme("dim");
    act(() => system.flip());
    expect(document.documentElement.dataset.theme).toBe("dim");
    stop();
  });

  it("offers System, Light, Dark and Dim", () => {
    stubSystem(false);
    render(<PrefsProvider><SettingsPage /></PrefsProvider>);
    expect(within(screen.getByRole("radiogroup", { name: "Theme" })).getAllByRole("radio").map((r) => r.textContent)).toEqual(["System", "Light", "Dark", "Dim"]);
    expect(screen.getByRole("radio", { name: "System" })).toBeChecked();
  });
});

describe("theme before first paint", () => {
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)![1]!;

  it("does not hard-code a theme in the page", () => {
    expect(html).not.toMatch(/<html[^>]*data-theme/);
  });

  it("sets data-theme from storage, else from the system", () => {
    stubSystem(true);
    localStorage.setItem(THEME_KEY, "dim");
    new Function(script)();
    expect(document.documentElement.dataset.theme).toBe("dim");
    localStorage.setItem(THEME_KEY, "system");
    new Function(script)();
    expect(document.documentElement.dataset.theme).toBe("dark");
    localStorage.clear();
    stubSystem(false);
    new Function(script)();
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("survives blocked storage", () => {
    stubSystem(true);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    new Function(script)();
    expect(document.documentElement.dataset.theme).toBe("dark");
    vi.restoreAllMocks();
  });
});
