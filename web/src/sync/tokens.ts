import { ApiFailure } from "../api/auth";
import type { ApprovalEngine, SyncApi } from "../api/authCrypto";
import type { ZoneChanges } from "../generated/ZoneChanges";
import type { Applied } from "./mapping";

type Engine = ApprovalEngine & { sync: SyncApi };

/**
 * How a zone's change token is used and recovered, kept in one place. After a 410 `token_expired` the engine is told
 * (`tokenExpired(zone)`), which forgets the token so the zone is fetched from the start, and pages are applied with
 * `applyChangesFrom(zone, since, page)`, passing the token the page was fetched with (plain `applyChanges` is refused
 * during a refetch, and a page fetched with another token is a mismatch). After a refetch, records the full
 * listing no longer has go to the 30-day trash and nothing is re-uploaded.
 */
export interface ZoneTokens {
  /** Applies a page fetched with the token `since` (empty or undefined for the first page). */
  applyPage(e: Engine, zone: string, since: string | undefined, page: ZoneChanges, nowMillis: number): Applied;
  /** Whether the server refused the token we sent. */
  isExpired(error: unknown): boolean;
  /** Starts the zone over after an expired token: the zone is fetched again from the start. */
  restart(e: Engine, zone: string): void;
}

export const pinnedTokens: ZoneTokens = {
  applyPage: (e, zone, since, page, now) => JSON.parse(e.sync.applyChangesFrom(zone, since || undefined, JSON.stringify(page), now)) as Applied,
  isExpired: (error) => error instanceof ApiFailure && (error.code === "token_expired" || error.code === "invalid_change_token"),
  restart: (e, zone) => e.sync.tokenExpired(zone),
};
