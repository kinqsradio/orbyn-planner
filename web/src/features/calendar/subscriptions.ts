import { useEffect, useRef } from "react";
import { ApiError, NEEDS_ENGINE, configuredEngine, fetchFeedViaEngine, inDesktopApp } from "../../api/feeds";
import { IcsError, MAX_FEED_BYTES, parseIcs } from "../../lib/ics";
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

export const HTTPS_ONLY = "Use an https:// link";

/** The address to fetch: webcal:// is https://, and plain http:// is refused. Throws a FeedError otherwise. */
export function feedAddress(url: string): string {
  const address = url.trim().replace(/^webcal:\/\//i, "https://");
  let parsed: URL;
  try {
    parsed = new URL(address);
  } catch {
    throw new FeedError("That isn’t a web address. Paste the calendar’s link.");
  }
  if (parsed.protocol !== "https:") throw new FeedError(HTTPS_ONLY);
  return parsed.href;
}

/** The body as text, stopping with a refusal as soon as it is over the limit. */
async function readCapped(response: Response): Promise<string> {
  const tooBig = new FeedError("That calendar is larger than 5 MiB, which is more than this app reads.");
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_FEED_BYTES) throw tooBig;
  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).length > MAX_FEED_BYTES) throw tooBig;
    return text;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_FEED_BYTES) {
      void reader.cancel();
      throw tooBig;
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

const REFUSALS: Record<string, string> = {
  invalid_url: "That isn’t a calendar link the engine can read.",
  blocked_address: "The engine won’t fetch that address.",
  too_large: "That calendar is larger than 5 MiB, which is more than this app reads.",
  timeout: "The calendar’s server took too long to answer.",
  upstream_error: "The calendar’s server didn’t give a calendar.",
};

/** Whether this build can read subscriptions at all: through the engine, or, on the web, straight from the browser. */
export const subscriptionsAvailable = (engine: string | null = configuredEngine()) => engine !== null || !inDesktopApp();

/**
 * Fetches an ICS feed. With an engine configured the engine fetches it (it checks the address and
 * the size); otherwise the browser does, which many servers do not allow (no CORS headers; the
 * error says so), and which the desktop app cannot do at all.
 */
export async function fetchFeed(url: string, fetchFn: typeof fetch = fetch, engine: string | null = configuredEngine()): Promise<FeedEvent[]> {
  const address = feedAddress(url);
  if (engine !== null) {
    let text: string;
    try {
      text = await fetchFeedViaEngine(engine, address, fetchFn);
    } catch (error) {
      if (error instanceof ApiError) throw new FeedError(REFUSALS[error.code] ?? REFUSALS.upstream_error!);
      throw new FeedError(typeof navigator !== "undefined" && navigator.onLine === false ? "You’re offline." : "Couldn’t reach the Orbyn engine.");
    }
    return parseText(text);
  }
  if (inDesktopApp()) throw new FeedError(`${NEEDS_ENGINE}.`);
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
  return parseText(await readCapped(response));
}

function parseText(text: string): FeedEvent[] {
  try {
    return parseIcs(text);
  } catch (error) {
    if (error instanceof IcsError) throw new FeedError(error.message.includes("more than") ? `${error.message}.` : "That address isn’t a calendar feed.");
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
