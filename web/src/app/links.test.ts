import { afterEach, describe, expect, it, vi } from "vitest";
import { linksIn, openExternal } from "./links";

afterEach(() => {
  vi.unstubAllGlobals();
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
});

describe("links in notes", () => {
  it("finds web addresses and nothing else", () => {
    expect(linksIn("See https://example.com/a?b=1, then http://x.test. Also javascript:alert(1) and file:///etc/passwd and ftp://x.test")).toEqual([
      "https://example.com/a?b=1",
      "http://x.test",
    ]);
    expect(linksIn("https://user:pw@x.test/")).toEqual([]);
  });

  it("in the desktop app goes through the shell's open_link, and only for http(s)", () => {
    const invoke = vi.fn(async () => undefined);
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = { invoke };
    openExternal("https://example.com/");
    openExternal("javascript:alert(1)");
    openExternal("file:///etc/passwd");
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("open_link", { url: "https://example.com/" });
  });

  it("in a browser opens a tab without the opener", () => {
    const open = vi.fn();
    vi.stubGlobal("open", open);
    openExternal("https://example.com/");
    expect(open).toHaveBeenCalledWith("https://example.com/", "_blank", "noopener,noreferrer");
  });
});
