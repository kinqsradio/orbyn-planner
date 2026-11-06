import { afterEach, describe, expect, it, vi } from "vitest";
import { HEALTH_TIMEOUT_MS, getHealth } from "./engine";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const body = { status: "ok", version: "0.1.0", database: "unavailable" };

describe("getHealth", () => {
  it("parses the engine's health", async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.endsWith("/health") ? new Response(JSON.stringify(body)) : new Response("", { status: 404 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(getHealth()).resolves.toEqual(body);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://localhost:8080/health");
  });

  it("rejects on an error status", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 503 })));
    await expect(getHealth()).rejects.toThrow("503");
  });

  it.each([
    ["not an object", "null"],
    ["a missing field", JSON.stringify({ status: "ok", version: "1" })],
    ["an unknown state", JSON.stringify({ status: "great", version: "1", database: "ok" })],
    ["a non-string version", JSON.stringify({ status: "ok", version: 1, database: "ok" })],
  ])("throws on %s", async (_name, text) => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(text)));
    await expect(getHealth()).rejects.toThrow(/unexpected/);
  });

  it("gives up after the timeout, and also when the caller aborts", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    let seen: AbortSignal | undefined;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      seen = init?.signal ?? undefined;
      return new Response(JSON.stringify(body));
    }));
    const caller = new AbortController();
    await getHealth(caller.signal);
    expect(timeout).toHaveBeenCalledWith(HEALTH_TIMEOUT_MS);
    expect(seen?.aborted).toBe(false);
    caller.abort();
    expect(seen?.aborted).toBe(true);
  });
});
