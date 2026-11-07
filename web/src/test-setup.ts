import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
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

// `getByRole` checks, for every element, whether it is hidden from the accessibility tree, which means computing styles up the whole
// tree: most of what a UI test spends when the machine is busy. Roles are matched on the elements as they are; the few tests that
// care about hidden content say so (`hidden: false`).
configure({ defaultHidden: true });
