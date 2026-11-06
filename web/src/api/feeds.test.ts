import { describe, expect, it, vi } from "vitest";
import { fetchFeed } from "../features/calendar/subscriptions";
import { ApiError, fetchFeedViaEngine } from "./feeds";

const FEED = ["BEGIN:VCALENDAR", "BEGIN:VEVENT", "DTSTART:20261107T090000", "SUMMARY:Open day", "END:VEVENT", "END:VCALENDAR"].join("\r\n");
const answer = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("fetching a feed through the engine", () => {
  it("posts the address and reads the calendar text from the answer", async () => {
    const fetchFn = answer({ status: 200, body: FEED });
    expect(await fetchFeedViaEngine("http://engine", "https://e.com/a.ics", fetchFn)).toBe(FEED);
    const [url, init] = (fetchFn as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]!;
    expect(url).toBe("http://engine/v1/feeds/fetch");
    expect(init).toMatchObject({ method: "POST", body: JSON.stringify({ url: "https://e.com/a.ics" }) });
  });

  it("turns each refusal into an ApiError with its code", async () => {
    for (const code of ["invalid_url", "blocked_address", "too_large", "timeout", "upstream_error"]) {
      await expect(fetchFeedViaEngine("http://engine", "https://e.com/a.ics", answer({ code }, 422))).rejects.toMatchObject({ name: "ApiError", code, status: 422 });
    }
    await expect(fetchFeedViaEngine("http://engine", "https://e.com/a.ics", answer({}, 500))).rejects.toBeInstanceOf(ApiError);
    await expect(fetchFeedViaEngine("http://engine", "https://e.com/a.ics", answer({ status: 404, body: "" }))).rejects.toMatchObject({ code: "upstream_error", status: 404 });
  });

  it("fetchFeed uses the engine when one is configured, and says why when it refuses", async () => {
    const events = await fetchFeed("webcal://e.com/a.ics", answer({ status: 200, body: FEED }), "http://engine");
    expect(events.map((e) => e.title)).toEqual(["Open day"]);
    await expect(fetchFeed("https://e.com/a.ics", answer({ code: "blocked_address" }, 403), "http://engine")).rejects.toThrow(/won’t fetch/);
  });
});
