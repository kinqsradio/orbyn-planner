import { afterEach, describe, expect, it, vi } from "vitest";
import { setMemoryOnly } from "../../lib/browserStorage";
import { loadShown, rememberShown } from "./shown";

afterEach(() => {
  setMemoryOnly(false);
  vi.unstubAllGlobals();
});

describe("what was shown, while an account's keys are held in memory only", () => {
  it("is kept for this tab and never written to IndexedDB", async () => {
    const open = vi.fn(() => {
      throw new Error("IndexedDB must not be opened");
    });
    vi.stubGlobal("indexedDB", { open });
    setMemoryOnly(true);
    await rememberShown("task|1");
    expect([...(await loadShown())]).toContain("task|1");
    expect(open).not.toHaveBeenCalled();
  });
});
