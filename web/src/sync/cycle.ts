import { ApiFailure } from "../api/auth";
import type { ApprovalEngine, SyncApi } from "../api/authCrypto";
import { emptySyncState, type StoredSession, type SyncState } from "../api/keyStore";
import type { AuthServices } from "../auth/services";
import type { DeviceList } from "../generated/DeviceList";
import type { RecordChanged } from "../generated/RecordChanged";
import type { UploadChanges } from "../generated/UploadChanges";
import type { UploadResult } from "../generated/UploadResult";
import type { Zone } from "../generated/Zone";
import type { ZoneChanges } from "../generated/ZoneChanges";
import type { ZoneList } from "../generated/ZoneList";
import { refKey } from "../store/outbox";
import { storedOf } from "../store/records";
import type { OutboxEntry, PlannerStore, RecordType, RemoteChange } from "../store/types";
import { pinnedTokens, TokenExpired, type ZoneTokens } from "./tokens";
import { stampFields, typeIn, valuesOf, zoneOf, type Accepted, type Applied, type Stamp, type StampedFields, type ZoneCheck } from "./mapping";

/** Something that stops a sync with a reason the person can be told. */
export class SyncError extends Error {
  constructor(
    readonly code: "sync_unavailable" | "token_expired" | "network" | "failed",
    message: string,
  ) {
    super(message);
    this.name = "SyncError";
  }
}

export interface CycleReport {
  /** Records sent. */
  uploaded: number;
  /** Records received (new or changed) and removed. */
  received: number;
  /** Trusted devices on the account. */
  devices: number;
  /** Zones that have changes waiting but no key on this device yet. */
  waitingForKeys: string[];
  /** Records this device cannot open yet, in all zones. */
  quarantined: number;
}

type Engine = ApprovalEngine & { sync: SyncApi };

const parse = <T>(json: string): T => JSON.parse(json) as T;
const MAX_BATCHES = 50;

/**
 * One pass of sync for a signed-in, trusted device: take the keys other devices sent, send the keys this
 * device owes, fetch what changed, then send the outbox. It never writes anything to the store that the
 * engine has not merged, and it clears an outbox entry only once its upload was acknowledged. A failure
 * throws, and the next pass picks up where this one stopped: staged edits and tokens are in the engine's
 * saved state, and the staged entries in the sync state.
 */
export async function runCycle(services: AuthServices, session: StoredSession, store: PlannerStore, tokens: ZoneTokens = pinnedTokens): Promise<CycleReport> {
  const { api, keys: keyStore } = services;
  const now = () => services.now();
  const state: SyncState = (await keyStore.loadSyncState()) ?? emptySyncState();
  const save = () => keyStore.saveSyncState(state);
  const report: CycleReport = { uploaded: 0, received: 0, devices: 0, waitingForKeys: [], quarantined: 0 };

  const withEngine = <T>(fn: (e: Engine) => T, restoreAtMs?: number): Promise<T> =>
    services.engine.run(
      session,
      (e) => {
        if (!e.sync) throw new SyncError("sync_unavailable", "This build can't sync: the engine's module isn't loaded.");
        return fn(e as Engine);
      },
      { restoreAtMs },
    );

  /** The records an `Applied` changed, as the store should have them. */
  function collect(e: Engine, zone: string, applied: Applied, retried = false): RemoteChange[] {
    const out: RemoteChange[] = [];
    const outbox = new Map(store.getState().outbox.map((o) => [refKey(o), o] as const));
    for (const id of applied.changed) {
      const type = typeIn(zone, id);
      const json = e.sync.record(zone, id);
      if (!type || !json) continue;
      const key = refKey({ type, id });
      let fields = valuesOf(parse<StampedFields>(json));
      // An edit not yet staged is newer than anything the engine has: it stays on screen, and is staged next.
      const pending = outbox.get(key);
      if (pending && state.staged[key] !== pending.idempotencyKey) {
        if (pending.op === "create") continue;
        fields = Object.fromEntries(Object.entries(fields).filter(([name]) => !(name in pending.changedFields)));
      }
      state.zoneOf[key] = zone;
      out.push({ type, id, fields });
    }
    for (const id of applied.removed) {
      const type = typeIn(zone, id);
      // A record that moved to another list is deleted from the old zone and made in the new one: the delete mustn't win.
      if (type && (state.zoneOf[refKey({ type, id })] ?? zone) === zone) out.push({ type, id, fields: null });
      else if (type) continue;
    }
    // Quarantine: what could not be opened, less what has opened since.
    // A retry lists exactly what is still unopened; a fetch adds to what was waiting.
    const waiting = new Set(retried ? [] : (state.quarantined[zone] ?? []));
    for (const id of applied.quarantined) waiting.add(id);
    for (const id of [...applied.changed, ...applied.removed, ...applied.evicted]) waiting.delete(id);
    if (waiting.size > 0) state.quarantined[zone] = [...waiting];
    else delete state.quarantined[zone];
    return out;
  }

  async function show(changes: RemoteChange[]): Promise<void> {
    if (changes.length === 0) return;
    report.received += changes.length;
    await store.applyRemote(changes);
  }

  // 0. Stage the outbox ------------------------------------------------------------------------------------
  // First, before anything is fetched: the engine's clock moves past every stamp it receives, so an edit
  // staged after a fetch would be stamped later than edits other devices made after it. Staged now, each edit
  // carries the time it was made, and merging with what arrives decides field by field.
  const entries = store.getState().outbox.filter((o) => state.staged[refKey(o)] !== o.idempotencyKey);
  if (entries.length > 0) {
    // Oldest first, with the clock started at the oldest: each edit is stamped with the time it was made.
    const oldest = [...entries].sort((x, y) => Date.parse(x.updatedAt) - Date.parse(y.updatedAt));
    await withEngine((e) => {
      for (const entry of oldest) stage(e, entry);
    }, Date.parse(oldest[0]!.updatedAt) || now());
    await save();
  }

  // 1. Devices, and the keys other devices sent --------------------------------------------------------
  const devices: DeviceList = await api.devices();
  const verified = await withEngine((e) => e.verifyDevices(devices));
  report.devices = devices.devices.filter((d) => d.state === "trusted").length;
  const envelopes = await api.keyEnvelopes();
  if (envelopes.envelopes.length > 0) {
    const opened = await withEngine((e) => {
      const accepted = parse<Accepted>(e.sync.acceptEnvelopes(JSON.stringify(envelopes), JSON.stringify(devices)));
      return accepted.zones.map((zone) => ({ zone, changes: collect(e, zone, parse<Applied>(e.sync.retryQuarantined(zone, now())), true) }));
    });
    for (const o of opened) {
      if (!state.zones.includes(o.zone)) state.zones.push(o.zone);
      await show(o.changes);
    }
  }

  // 2. The zones on the server ---------------------------------------------------------------------------
  const serverZones = new Map<string, Zone>();
  const stale: string[] = [];
  for (let after: string | undefined; ; ) {
    const page: ZoneList = await api.zones(after);
    for (const z of page.zones) serverZones.set(z.zone, z);
    const check = await withEngine((e) => parse<ZoneCheck>(e.sync.checkZones(JSON.stringify(page))));
    stale.push(...check.stale);
    after = check.next ?? undefined;
    if (!after) break;
  }
  for (const name of serverZones.keys()) if (!state.zones.includes(name)) state.zones.push(name);

  // 3. Fetch what changed -------------------------------------------------------------------------------------
  for (const zone of stale) {
    for (let page = 0; page < MAX_BATCHES * 10; page++) {
      const since = await withEngine((e) => e.sync.token(zone));
      let body: ZoneChanges;
      try {
        body = await api.changes(zone, since);
      } catch (error) {
        if (!tokens.isExpired(error)) throw error;
        try {
          await withEngine((e) => tokens.restart(e, zone));
        } catch (stopped) {
          if (stopped instanceof TokenExpired) throw new SyncError("token_expired", stopped.message);
          throw stopped;
        }
        continue; // restarted: fetch the zone again from the start
      }
      const changes = await withEngine((e) => collect(e, zone, tokens.applyPage(e, zone, since, body, now())));
      await show(changes);
      await save();
      if (!body.more) break;
    }
  }

  function stage(e: Engine, entry: OutboxEntry): void {
    const key = refKey(entry);
    const here = store.getState()[STORE_KEY[entry.type]].find((r) => r.id === entry.id) as { id: string; listId?: string; calendarId?: string } | undefined;
    const previous = state.zoneOf[key];
    const zone = here ? zoneOf(entry.type, here) : previous;
    if (!zone) {
      state.staged[key] = entry.idempotencyKey; // gone before it was ever sent: nothing to say
      delete state.stagedZone[key];
      return;
    }
    const hard = entry.op === "delete" && Object.keys(entry.changedFields).length === 0;
    if (!state.zones.includes(zone)) state.zones.push(zone);
    if (hard) {
      if (previous) e.sync.delete(previous, entry.id);
      delete state.zoneOf[key];
    } else {
      let fields = entry.changedFields;
      if (previous && previous !== zone) {
        // A task moved to another list: it is deleted from the old zone and made whole in the new one.
        e.sync.delete(previous, entry.id);
        fields = { ...(storedOf(entry.type, here as never) as unknown as Record<string, unknown>), ...fields };
      }
      const stamp = parse<Stamp>(e.sync.tick(Date.parse(entry.updatedAt) || now()));
      e.sync.stage(zone, entry.type, entry.id, JSON.stringify(stampFields(fields, stamp)));
      state.zoneOf[key] = zone;
    }
    state.staged[key] = entry.idempotencyKey;
    state.stagedZone[key] = zone;
  }

  // 5. Send it -------------------------------------------------------------------------------------------------
  const sentZones = new Set<string>();
  for (const zone of [...state.zones]) {
    let created = false;
    for (let batch = 0; batch < MAX_BATCHES; batch++) {
      let upload: string | undefined;
      try {
        upload = await withEngine((e) => e.sync.buildUpload(zone));
      } catch (error) {
        if (!hasCode(error, "no_zone_key")) throw error;
        if (serverZones.has(zone) || created) {
          // It exists and another device holds its key: wait for the envelope.
          report.waitingForKeys.push(zone);
          break;
        }
        // A zone nobody has made: this device makes it and its first key, and sends the key to the others.
        serverZones.set(zone, await api.createZone(zone));
        await withEngine((e) => e.sync.createZoneKey(zone));
        created = true;
        state.keysFor = "";
        continue;
      }
      if (upload === undefined) {
        sentZones.add(zone);
        break;
      }
      const body = parse<UploadChanges>(upload);
      try {
        const result: UploadResult = await api.upload(zone, body);
        await withEngine((e) => e.sync.uploadSucceeded(zone, JSON.stringify(result)));
        report.uploaded += body.changes.length;
      } catch (error) {
        if (error instanceof ApiFailure && error.code === "record_changed") {
          // Someone changed those records first: merge their copies and send again.
          const conflict = error.body as RecordChanged;
          const changes = await withEngine((e) => collect(e, zone, parse<Applied>(e.sync.uploadConflicted(zone, JSON.stringify(conflict), now()))));
          await show(changes);
          continue;
        }
        if (error instanceof ApiFailure && error.status >= 400 && error.status < 500 && error.status !== 429) {
          await withEngine((e) => e.sync.abandonUpload(zone)); // refused for good (a deleted zone, a too big batch)
        }
        throw error;
      }
    }
  }

  // 6. Keys this device owes the others ------------------------------------------------------------------
  const owes = [...verified].sort().join(",");
  if (state.keysFor !== owes && state.zones.length > 0) {
    for (const zone of state.zones) {
      const put = await withEngine((e) => {
        try {
          return e.sync.envelopesFor(zone, JSON.stringify(devices));
        } catch (error) {
          if (hasCode(error, "no_zone_key")) return null;
          throw error;
        }
      });
      if (put && parse<{ envelopes: unknown[] }>(put).envelopes.length > 0) await api.putKeyEnvelopes(parse(put));
    }
    state.keysFor = owes;
  }

  // 7. Clear what was acknowledged ------------------------------------------------------------------------
  const sent = store
    .getState()
    .outbox.filter((o) => state.staged[refKey(o)] === o.idempotencyKey && (state.stagedZone[refKey(o)] === undefined || sentZones.has(state.stagedZone[refKey(o)]!)))
    .map((o) => ({ type: o.type, id: o.id, idempotencyKey: o.idempotencyKey }));
  await store.acknowledge(sent);
  for (const s of sent) {
    delete state.staged[refKey(s)];
    delete state.stagedZone[refKey(s)];
  }

  report.quarantined = Object.values(state.quarantined).reduce((n, ids) => n + ids.length, 0);
  state.lastSyncedAt = new Date(now()).toISOString();
  await save();
  return report;
}

const STORE_KEY = { task: "tasks", list: "lists", event: "events", calendar: "calendars", project: "projects" } as const satisfies Record<RecordType, string>;

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && error.message.startsWith(`${code}:`);
}
