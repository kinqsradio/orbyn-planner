import { describe, expect, it, vi } from "vitest";
import { fetchFeed } from "../features/calendar/subscriptions";
import { ApiError, fetchFeedViaEngine } from "./feeds";
import { sessionToken, setSessionToken } from "./session";

const FEED = ["BEGIN:VCALENDAR", "BEGIN:VEVENT", "DTSTART:20261107T090000", "SUMMARY:Open day", "END:VEVENT", "END:VCALENDAR"].join("\r\n");
const answer = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("fetching a feed through the engine", () => {
  it("posts the address and reads the calendar text from the answer", async () => {
    const fetchFn = answer({ status: 200, body: FEED });
    expect(await fetchFeedViaEngine("http://engine", "https://e.com/a.ics", "tok", fetchFn)).toBe(FEED);
    const [url, init] = (fetchFn as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]!;
    expect(url).toBe("http://engine/v1/feeds/fetch");
    expect(init).toMatchObject({ method: "POST", body: JSON.stringify({ url: "https://e.com/a.ics" }) });
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok");
  });

  it("turns each refusal into an ApiError with its code", async () => {
    for (const code of ["invalid_url", "blocked_address", "too_large", "timeout", "upstream_error"]) {
      await expect(fetchFeedViaEngine("http://engine", "https://e.com/a.ics", "tok", answer({ code }, 422))).rejects.toMatchObject({ name: "ApiError", code, status: 422 });
    }
    await expect(fetchFeedViaEngine("http://engine", "https://e.com/a.ics", "tok", answer({}, 500))).rejects.toBeInstanceOf(ApiError);
    for (const [status, code] of [[401, "unauthorized"], [403, "device_not_trusted"], [429, "too_many_attempts"], [503, "feeds_unavailable"], [500, "internal"]] as const) {
      await expect(fetchFeedViaEngine("http://engine", "https://e.com/a.ics", "tok", answer({}, status))).rejects.toMatchObject({ code, status });
    }
    await expect(fetchFeedViaEngine("http://engine", "https://e.com/a.ics", "tok", answer({ status: 404, body: "" }))).rejects.toMatchObject({ code: "upstream_error", status: 404 });
  });

  it("fetchFeed uses the engine when one is configured, and says why when it refuses", async () => {
    const events = await fetchFeed("webcal://e.com/a.ics", answer({ status: 200, body: FEED }), "http://engine", "tok");
    expect(events.map((e) => e.title)).toEqual(["Open day"]);
    await expect(fetchFeed("https://e.com/a.ics", answer({ code: "blocked_address" }, 403), "http://engine", "tok")).rejects.toThrow(/won’t fetch/);
    await expect(fetchFeed("https://e.com/a.ics", answer({ code: "unauthorized" }, 401), "http://engine", "tok")).rejects.toThrow(/Sign in/);
    await expect(fetchFeed("https://e.com/a.ics", answer({ code: "too_many_attempts" }, 429), "http://engine", "tok")).rejects.toThrow(/Try again later/);
  });

  it("a 401 from the feed route forgets the session token, so later refreshes take the signed-out path", async () => {
    setSessionToken("tok");
    await expect(fetchFeed("https://e.com/a.ics", answer({ code: "unauthorized" }, 401), "http://engine", "tok")).rejects.toThrow(/Sign in/);
    expect(sessionToken()).toBeNull();
    // A different token (a newer sign-in) is not forgotten by an old request's 401.
    setSessionToken("newer");
    await expect(fetchFeed("https://e.com/a.ics", answer({ code: "unauthorized" }, 401), "http://engine", "tok")).rejects.toThrow();
    expect(sessionToken()).toBe("newer");
    setSessionToken(null);
  });

  it("reads the feed in the browser when signed out, and asks for sign-in in the desktop app", async () => {
    const direct = vi.fn(async () => new Response(FEED, { status: 200 })) as unknown as typeof fetch;
    expect((await fetchFeed("https://e.com/a.ics", direct, "http://engine", null)).map((e) => e.title)).toEqual(["Open day"]);
    expect((direct as unknown as { mock: { calls: [string][] } }).mock.calls[0]![0]).toBe("https://e.com/a.ics");
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    try {
      await expect(fetchFeed("https://e.com/a.ics", direct, "http://engine", null)).rejects.toThrow(/Sign in to subscribe/);
    } finally {
      delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    }
  });
});
