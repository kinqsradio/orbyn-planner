import { ApiFailure } from "../api/auth";
import type { ApprovalEngine, SyncApi } from "../api/authCrypto";
import type { ZoneChanges } from "../generated/ZoneChanges";
import type { Applied } from "./mapping";

type Engine = ApprovalEngine & { sync: SyncApi };

/**
 * How a zone's change token is used and recovered, kept in one place because the engine's API for it is
 * about to change (engine#16, purge): after a 410 `token_expired` the host will call
 * `engine.tokenExpired(zone)` to restart the zone, and apply pages only with
 * `applyChangesFrom(zone, since, page)`, passing the token the page was fetched with (plain
 * `applyChanges` is refused during a refetch, and a page fetched with another token is a Mismatch). After
 * a refetch, records the full listing no longer has go to the 30-day trash and nothing is re-uploaded.
 *
 * The pinned module has none of that, so this adapter applies pages plainly and stops with a reason when a
 * token has expired. When the pin moves, `applyPage` calls `applyChangesFrom` and `restart` calls
 * `tokenExpired`; nothing else in the sync layer changes.
 */
export interface ZoneTokens {
  /** Applies a page fetched with the token `since` (undefined for the first page). */
  applyPage(e: Engine, zone: string, since: string | undefined, page: ZoneChanges, nowMillis: number): Applied;
  /** Whether the server refused the token we sent. */
  isExpired(error: unknown): boolean;
  /** Starts the zone over after an expired token. The pinned module can't, so it says so. */
  restart(e: Engine, zone: string): never;
}

export class TokenExpired extends Error {
  constructor(readonly zone: string) {
    super("This device's place in a list or calendar is too old to continue from, and this version can't start it over.");
    this.name = "TokenExpired";
  }
}

export const pinnedTokens: ZoneTokens = {
  applyPage: (e, zone, _since, page, now) => JSON.parse(e.sync.applyChanges(zone, JSON.stringify(page), now)) as Applied,
  isExpired: (error) => error instanceof ApiFailure && (error.code === "token_expired" || error.code === "invalid_change_token"),
  // TODO(engine#16): `e.sync.tokenExpired(zone)` here, then refetch the zone from the start and apply with applyChangesFrom.
  restart: (_e, zone) => {
    throw new TokenExpired(zone);
  },
};
