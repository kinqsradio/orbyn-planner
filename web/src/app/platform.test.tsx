import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsPage } from "../features/settings/SettingsPage";
import { detectPlatform, isDesktop } from "./platform";
import { PrefsProvider } from "./prefs";

const Settings = () => (
  <PrefsProvider>
    <SettingsPage />
  </PrefsProvider>
);

afterEach(() => {
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  vi.unstubAllGlobals();
});

describe("detectPlatform", () => {
  it("is web in a browser, whatever the user agent says", () => {
    expect(detectPlatform({})).toBe("web");
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 Tauri/2.0 Orbyn Planner Desktop" });
    expect(isDesktop()).toBe(false);
  });

  it("is desktop when Tauri has put its internals on the window", () => {
    expect(detectPlatform({ __TAURI_INTERNALS__: {} })).toBe("desktop");
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    expect(isDesktop()).toBe(true);
  });
});

describe("the install hint", () => {
  const openPlanning = async () => {
    render(<Settings />);
    await userEvent.click(screen.getByRole("button", { name: "Planning" }));
  };

  it("shows on the web", async () => {
    await openPlanning();
    expect(screen.getByText(/coming as a desktop app/)).toBeInTheDocument();
  });

  it("is hidden in the desktop app, and nothing else on the page changes", async () => {
    const web = render(<Settings />);
    const before = web.container.innerHTML.replace(/<p class="t3 small install-hint">.*?<\/p>/, "");
    web.unmount();
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    const desktop = render(<Settings />);
    expect(screen.queryByText(/coming as a desktop app/)).not.toBeInTheDocument();
    expect(desktop.container.innerHTML).toBe(before);
  });
});
