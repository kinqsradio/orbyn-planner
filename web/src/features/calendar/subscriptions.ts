import { useEffect, useRef } from "react";
import { IcsError, parseIcs } from "../../lib/ics";
import { usePlanner, useStore } from "../../store/context";
import type { FeedEvent, PlannerCalendar, PlannerStore } from "../../store/types";

/** How often a subscribed calendar is read again while the app is open. */
export const REFRESH_MS = 3_600_000;

export class FeedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FeedError";
  }
}

/** Fetches an ICS feed straight from the browser. Many servers do not allow that (no CORS headers); the error says so. */
export async function fetchFeed(url: string, fetchFn: typeof fetch = fetch): Promise<FeedEvent[]> {
  const address = url.trim().replace(/^webcal:\/\//i, "https://");
  let response: Response;
  try {
    response = await fetchFn(address, { cache: "no-store" });
  } catch {
    // The browser gives the same error for "offline" and "the server does not allow this page to read it".
    throw new FeedError(
      typeof navigator !== "undefined" && navigator.onLine === false
        ? "You’re offline."
        : "This calendar’s server doesn’t allow browser access yet, so it can’t be refreshed here.",
    );
  }
  if (!response.ok) throw new FeedError(`The server answered ${response.status}.`);
  try {
    return parseIcs(await response.text());
  } catch (error) {
    if (error instanceof IcsError) throw new FeedError("That address isn’t a calendar feed.");
    throw error;
  }
}

const running = new Set<string>();

/** Reads a subscribed calendar again. A failure is recorded on the calendar, for "Couldn’t refresh · Retry". */
export async function refreshCalendar(store: PlannerStore, calendar: PlannerCalendar, fetchFn: typeof fetch = fetch): Promise<boolean> {
  if (calendar.kind.type !== "subscribed" || running.has(calendar.id)) return false;
  running.add(calendar.id);
  try {
    const events = await fetchFeed(calendar.kind.url, fetchFn);
    store.replaceFeedEvents(calendar.id, events);
    return true;
  } catch (error) {
    store.failSubscription(calendar.id, error instanceof FeedError ? error.message : "Couldn’t read that calendar.");
    return false;
  } finally {
    running.delete(calendar.id);
  }
}

/** While the app is open: read stale subscriptions now, and every subscription once an hour. */
export function useSubscriptionRefresh(now: () => number = Date.now): void {
  const store = useStore();
  const { calendars, ready } = usePlanner();
  const latest = useRef(calendars);
  useEffect(() => {
    latest.current = calendars;
  });

  useEffect(() => {
    if (!ready) return;
    const run = (onlyStale: boolean) => {
      for (const c of latest.current) {
        if (c.kind.type !== "subscribed") continue;
        const last = c.kind.lastRefreshed ? new Date(c.kind.lastRefreshed).getTime() : 0;
        if (onlyStale && now() - last < REFRESH_MS) continue;
        void refreshCalendar(store, c);
      }
    };
    run(true);
    const timer = setInterval(() => run(false), REFRESH_MS);
    return () => clearInterval(timer);
  }, [store, ready, now]);
}
