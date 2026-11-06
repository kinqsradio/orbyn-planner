import { afterEach, describe, expect, it, vi } from "vitest";
import { linksIn, listenForExternalLinks, openExternal } from "./links";

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

describe("clicks on links in the desktop app", () => {
  function setup(href: string) {
    const invoke = vi.fn(async () => undefined);
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = { invoke };
    const a = document.createElement("a");
    a.setAttribute("href", href);
    const inner = document.createElement("span");
    a.append(inner);
    document.body.append(a);
    const stop = listenForExternalLinks();
    const fire = (type: string, button: number) => {
      const event = new MouseEvent(type, { button, bubbles: true, cancelable: true });
      inner.dispatchEvent(event);
      return event;
    };
    return {
      invoke,
      fire,
      done: () => {
        stop();
        a.remove();
      },
    };
  }

  it("a primary click opens the system browser and does not navigate the window", () => {
    const { invoke, fire, done } = setup("https://example.com/a");
    const event = fire("click", 0);
    expect(invoke).toHaveBeenCalledWith("open_link", { url: "https://example.com/a" });
    expect(event.defaultPrevented).toBe(true);
    done();
  });

  it("a middle click (auxclick) does too", () => {
    const { invoke, fire, done } = setup("https://example.com/a");
    const event = fire("auxclick", 1);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("open_link", { url: "https://example.com/a" });
    expect(event.defaultPrevented).toBe(true);
    done();
  });

  it("a right click and a non-web link are left alone", () => {
    const right = setup("https://example.com/a");
    expect(right.fire("auxclick", 2).defaultPrevented).toBe(false);
    expect(right.invoke).not.toHaveBeenCalled();
    right.done();
    const local = setup("mailto:someone@example.com");
    expect(local.fire("auxclick", 1).defaultPrevented).toBe(false);
    expect(local.fire("click", 0).defaultPrevented).toBe(false);
    expect(local.invoke).not.toHaveBeenCalled();
    local.done();
  });

  it("stops listening when asked", () => {
    const { invoke, fire, done } = setup("https://example.com/a");
    done();
    fire("auxclick", 1);
    expect(invoke).not.toHaveBeenCalled();
  });
});
