import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { SettingsPage } from "../features/settings/SettingsPage";
import { applyTheme, initialTheme, THEME_KEY } from "./theme";

describe("theme", () => {
  it("persists the choice and sets data-theme", async () => {
    render(<SettingsPage />);
    await userEvent.click(screen.getByRole("radio", { name: "Dim" }));
    expect(document.documentElement.dataset.theme).toBe("dim");
    expect(localStorage.getItem(THEME_KEY)).toBe("dim");
    expect(screen.getByRole("radio", { name: "Dim" })).toBeChecked();
  });

  it("restores a stored choice and ignores junk", () => {
    localStorage.setItem(THEME_KEY, "dark");
    expect(initialTheme()).toBe("dark");
    applyTheme(initialTheme());
    expect(document.documentElement.dataset.theme).toBe("dark");
    localStorage.setItem(THEME_KEY, "neon");
    expect(["light", "dark"]).toContain(initialTheme());
  });
});
