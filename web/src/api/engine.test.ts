import { afterEach, describe, expect, it, vi } from "vitest";
import { getHealth } from "./engine";

afterEach(() => vi.unstubAllGlobals());

describe("getHealth", () => {
  it("parses the engine's health", async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.endsWith("/health")
        ? new Response(JSON.stringify({ status: "ok", version: "0.1.0", database: "unavailable" }))
        : new Response("", { status: 404 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(getHealth()).resolves.toEqual({ status: "ok", version: "0.1.0", database: "unavailable" });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://localhost:8080/health");
  });

  it("rejects on an error status", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 503 })));
    await expect(getHealth()).rejects.toThrow("503");
  });
});
