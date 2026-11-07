import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach } from "vitest";

// The direct `userEvent.click(...)` calls wait a macrotask between every pointer and key step. Under a busy machine those waits are
// what makes a UI test slow and timing-dependent, and nothing here depends on them, so the direct calls run without the delay.
beforeEach(() => {
  if (typeof document === "undefined") return;
  const instant = userEvent.setup({ delay: null });
  for (const name of Object.keys(instant) as (keyof typeof instant)[]) {
    if (name !== "setup") (userEvent as unknown as Record<string, unknown>)[name] = instant[name];
  }
});

afterEach(() => {
  cleanup();
  if (typeof localStorage !== "undefined") localStorage.clear();
  if (typeof document !== "undefined") document.documentElement.removeAttribute("data-theme");
});
