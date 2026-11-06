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
  });

  it("changes page and URL from the sidebar and follows history", async () => {
    render(<App />);
    const nav = screen.getByRole("navigation", { name: "Main" });
    await userEvent.click(within(nav).getByRole("link", { name: "Calendar" }));
    expect(window.location.pathname).toBe("/calendar");
    expect(screen.getByRole("heading", { level: 1, name: "Calendar" })).toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: "Calendar" })).toHaveAttribute("aria-current", "page");

    window.history.pushState(null, "", "/lists");
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(await screen.findByRole("heading", { level: 1, name: "Lists" })).toBeInTheDocument();
  });
});
