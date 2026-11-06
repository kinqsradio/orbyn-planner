import { MAX_FEED_BYTES } from "../lib/ics";

/**
 * The engine's wire types for POST /v1/feeds/fetch (orbyn-engine #9), typed by hand until its
 * bindings reach `src/generated`; then these two are replaced by the generated ones.
 */
export interface FeedFetch {
  url: string;
}
export interface FeedFetched {
  status: number;
  body: string;
}

/** Why the engine refused to fetch a feed. */
export type FeedRefusal =
  | "invalid_url"
  | "blocked_address"
  | "too_large"
  | "timeout"
  | "upstream_error"
  | "unauthorized"
  | "device_not_trusted"
  | "too_many_attempts"
  | "feeds_unavailable"
  | "internal";
const REFUSALS: readonly FeedRefusal[] = [
  "invalid_url",
  "blocked_address",
  "too_large",
  "timeout",
  "upstream_error",
  "unauthorized",
  "device_not_trusted",
  "too_many_attempts",
  "feeds_unavailable",
  "internal",
];

/** The engine answered, but not with a feed. `code` says why. */
export class ApiError extends Error {
  constructor(
    readonly code: FeedRefusal,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** The engine's address when one is configured for this build (VITE_ENGINE_URL), otherwise null. */
export function configuredEngine(): string | null {
  const url = import.meta.env.VITE_ENGINE_URL;
  return typeof url === "string" && url.trim() !== "" ? url.replace(/\/+$/, "") : null;
}

/** The desktop app's page may not fetch other sites (its security policy forbids it), so it needs the engine for feeds. */
export function inDesktopApp(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export const NEEDS_ENGINE = "Subscriptions need the Orbyn engine";
export const NEEDS_SIGN_IN = "Sign in to subscribe to calendars";

/** The refusal the engine named, or one read from the HTTP status when the body names none. */
function codeOf(body: unknown, status: number): FeedRefusal {
  const v = body as { code?: unknown; error?: unknown } | null;
  const raw = typeof v?.code === "string" ? v.code : typeof v?.error === "string" ? v.error : (v?.error as { code?: unknown } | undefined)?.code;
  const named = REFUSALS.find((r) => r === raw);
  if (named) return named;
  if (status === 401) return "unauthorized";
  if (status === 403) return "device_not_trusted";
  if (status === 429) return "too_many_attempts";
  if (status === 503) return "feeds_unavailable";
  if (status >= 500) return "internal";
  return "upstream_error";
}

/**
 * Has the engine fetch a feed: `POST {engine}/v1/feeds/fetch` with `{ url }`, answered with
 * `{ status, body }` where body is the calendar text. The engine refuses addresses it should not
 * reach, so a page that cannot fetch the feed itself still can subscribe to it. The route needs a
 * signed-in, trusted device, so the session's bearer token goes with it.
 */
export async function fetchFeedViaEngine(engine: string, url: string, token: string, fetchFn: typeof fetch = fetch): Promise<string> {
  const response = await fetchFn(`${engine}/v1/feeds/fetch`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ url } satisfies FeedFetch),
    cache: "no-store",
  });
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Not JSON: handled below.
  }
  if (!response.ok) throw new ApiError(codeOf(body, response.status), response.status, `The engine refused the feed (${response.status}).`);
  const v = body as Partial<Record<keyof FeedFetched, unknown>> | null;
  if (typeof v?.status !== "number" || typeof v.body !== "string") throw new ApiError("upstream_error", response.status, "The engine gave an unexpected answer.");
  if (v.status < 200 || v.status >= 300) throw new ApiError("upstream_error", v.status, `The calendar’s server answered ${v.status}.`);
  if (new TextEncoder().encode(v.body).length > MAX_FEED_BYTES) throw new ApiError("too_large", response.status, "The calendar is too large.");
  return v.body;
}
