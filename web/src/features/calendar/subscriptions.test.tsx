import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalStore } from "../../store/LocalStore";
import { MemoryPersistence } from "../../store/persistence";
import { StoreProvider } from "../../store/context";
import { FeedError, REFRESH_MS, fetchFeed, refreshCalendar, useSubscriptionRefresh } from "./subscriptions";

const FEED = ["BEGIN:VCALENDAR", "BEGIN:VEVENT", "DTSTART:20261107T090000", "SUMMARY:Open day", "END:VEVENT", "END:VCALENDAR"].join("\r\n");
const ok = (body = FEED) => vi.fn(async () => new Response(body)) as unknown as typeof fetch;

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("fetchFeed", () => {
  it("reads events and turns webcal:// into https://", async () => {
    const fetchFn = ok();
    const events = await fetchFeed("webcal://example.com/a.ics", fetchFn);
    expect(events.map((e) => e.title)).toEqual(["Open day"]);
    expect(vi.mocked(fetchFn).mock.calls[0]![0]).toBe("https://example.com/a.ics");
  });

  it("explains a blocked feed as no browser access yet", async () => {
    const blocked = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    await expect(fetchFeed("https://example.com/a.ics", blocked)).rejects.toThrow("doesn’t allow browser access yet");
  });

  it("says when the device is offline", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const blocked = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    await expect(fetchFeed("https://example.com/a.ics", blocked)).rejects.toThrow("You’re offline.");
    vi.restoreAllMocks();
  });

  it("reports an error status and text that is not a calendar", async () => {
    await expect(fetchFeed("https://e.com/a.ics", vi.fn(async () => new Response("no", { status: 404 })) as unknown as typeof fetch)).rejects.toThrow("The server answered 404.");
    await expect(fetchFeed("https://e.com/a.ics", ok("<html>hi</html>"))).rejects.toThrow(FeedError);
    await expect(fetchFeed("https://e.com/a.ics", ok("<html>hi</html>"))).rejects.toThrow("That address isn’t a calendar feed.");
  });
});

async function subscribed(fetchFn: typeof fetch) {
  let now = new Date("2026-11-07T10:00:00Z");
  const store = new LocalStore({ persistence: new MemoryPersistence(), now: () => now, broadcast: false });
  await store.ready;
  const calendar = store.addSubscription("Holidays", "c3", "https://example.com/h.ics");
  return { store, calendar, setNow: (d: Date) => (now = d), fetchFn };
}

describe("refreshCalendar", () => {
  it("fills the calendar and clears an earlier error", async () => {
    const { store, calendar } = await subscribed(ok());
    store.failSubscription(calendar.id, "old");
    expect(await refreshCalendar(store, store.getState().calendars.find((c) => c.id === calendar.id)!, ok())).toBe(true);
    const after = store.getState().calendars.find((c) => c.id === calendar.id)!;
    expect(after.kind).toMatchObject({ error: null, lastRefreshed: expect.any(String) });
    expect(store.getState().events.map((e) => e.title)).toEqual(["Open day"]);
  });

  it("records the failure and keeps the events it had", async () => {
    const { store, calendar } = await subscribed(ok());
    await refreshCalendar(store, calendar, ok());
    const blocked = vi.fn(async () => {
      throw new TypeError("x");
    }) as unknown as typeof fetch;
    expect(await refreshCalendar(store, store.getState().calendars.find((c) => c.id === calendar.id)!, blocked)).toBe(false);
    expect(store.getState().calendars.find((c) => c.id === calendar.id)!.kind).toMatchObject({ error: expect.stringContaining("browser access") });
    expect(store.getState().events).toHaveLength(1);
  });
});

describe("hourly refresh while open", () => {
  it("reads a new subscription at once and then every hour", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchFn = ok();
    vi.stubGlobal("fetch", fetchFn);
    const { store, setNow } = await subscribed(fetchFn);
    function Probe() {
      useSubscriptionRefresh(() => Date.now());
      return null;
    }
    render(
      <StoreProvider store={store}>
        <Probe />
      </StoreProvider>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    setNow(new Date(Date.now() + REFRESH_MS));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REFRESH_MS + 10);
    });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});
