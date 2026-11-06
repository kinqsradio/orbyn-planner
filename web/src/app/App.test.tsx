import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("offline"))));
});

describe("navigation", () => {
  it("shows the Today empty state first", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: "Nothing planned yet" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New task" })).toBeDisabled();
    expect(screen.getByText("Done this week")).toBeInTheDocument();
  });

  it("changes page and URL from the sidebar and follows history", async () => {
    render(<App />);
    const nav = screen.getByRole("navigation", { name: "Primary" });
    await userEvent.click(within(nav).getByRole("link", { name: "Calendar" }));
    expect(window.location.pathname).toBe("/calendar");
    expect(screen.getByRole("heading", { level: 1, name: "Calendar" })).toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: "Calendar" })).toHaveAttribute("aria-current", "page");

    window.history.pushState(null, "", "/lists");
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(await screen.findByRole("heading", { level: 1, name: "Lists" })).toBeInTheDocument();
  });

  it("keeps every primary destination, Settings included, in one navigation", () => {
    render(<App />);
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(within(nav).getAllByRole("link").map((l) => l.textContent)).toEqual([
      "Today", "Tasks", "Calendar", "Lists", "Projects", "Notifications", "Settings",
    ]);
  });

  it("starts with a skip link that moves focus to the content", async () => {
    render(<App />);
    await userEvent.tab();
    const skip = screen.getByRole("link", { name: "Skip to content" });
    expect(skip).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(screen.getByRole("main")).toHaveFocus();
  });
});

describe("phone tab bar", () => {
  it("reaches Projects, Notifications and Settings through More", async () => {
    render(<App />);
    const tabs = screen.getByRole("navigation", { name: "Tabs" });
    expect(within(tabs).getAllByRole("link").map((l) => l.textContent)).toEqual(["Today", "Tasks", "Calendar", "Lists", "Search"]);
    const more = within(tabs).getByRole("button", { name: "More" });
    await userEvent.click(more);
    const sheet = screen.getByRole("dialog", { name: "More" });
    expect(within(sheet).getAllByRole("link").map((l) => l.textContent)).toEqual(["Projects", "Notifications", "Settings"]);
    await userEvent.click(within(sheet).getByRole("link", { name: "Settings" }));
    expect(window.location.pathname).toBe("/settings");
    expect(screen.queryByRole("dialog", { name: "More" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Planning" })).toBeInTheDocument();
  });

  it("closes with Escape and returns focus to More", async () => {
    render(<App />);
    const more = within(screen.getByRole("navigation", { name: "Tabs" })).getByRole("button", { name: "More" });
    await userEvent.click(more);
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "More" })).not.toBeInTheDocument();
    expect(more).toHaveFocus();
  });
});
