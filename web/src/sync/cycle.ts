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
import { acceptable, stampFields, valuesOf, zoneOf, type Accepted, type Applied, type Stamp, type StampedFields, type ZoneCheck } from "./mapping";
import { pinnedTokens, type ZoneTokens } from "./tokens";

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

/** The pass was stopped (sign-out, or the tab leaving): nothing it was doing is to be used or saved. */
export class Aborted extends Error {
  constructor() {
    super("The sync was stopped.");
    this.name = "Aborted";
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
  /** Zones waiting for a key when this is the only trusted device: no device of the account can open them. */
  stranded: string[];
  /** This device trusts nobody but itself while the server lists others as trusted: it must be approved again before it can open or send anything. */
  needsApproval: boolean;
  /** Zones whose keys couldn't be sent to the other devices yet, so nothing is uploaded to them. */
  keysPending: string[];
  /** Records this device cannot open yet, in all zones. */
  quarantined: number;
  /** Lists or calendars deleted on another device while this one had changes for them: those changes were dropped. */
  dropped: { zone: string; records: number }[];
  /** Titles of records another device deleted while this one had unsent changes for them: the changes stay in the 30-day trash. */
  trashedEdits: string[];
  /** Changes that can't be sent (too large), left out of uploads. */
  failed: { type: RecordType; id: string; reason: string }[];
  /** Zones skipped for a while after the server refused an upload. */
  skipped: string[];
}

type Engine = ApprovalEngine & { sync: SyncApi };

const parse = <T>(json: string): T => JSON.parse(json) as T;
const MAX_BATCHES = 50;
/** A record's fields, sealed, must fit the server's 256 KiB; this leaves room for the envelope around them. */
const MAX_RECORD_BYTES = 200_000;
const BACKOFF_FIRST_MS = 60_000;
const BACKOFF_MAX_MS = 15 * 60_000;

/**
 * One pass of sync for a signed-in, trusted device: stage the outbox, take the keys other devices sent,
 * fetch what changed, send the keys this device owes, then send the outbox. It never writes anything to the
 * store that the engine has not merged, and it clears an outbox entry only once its upload was acknowledged.
 * A failure throws, and the next pass picks up where this one stopped: staged edits and tokens are in the
 * engine's saved state, and the staged entries in the sync state.
 *
 * One refused upload doesn't stop the rest: each zone is tried on its own, and the keys and the clearing
 * of acknowledged entries always run. `signal.aborted` is checked between steps and before anything is
 * saved or shown, so a pass that outlives `stop()` (a sign-out) changes nothing.
 */
export async function runCycle(
  services: AuthServices,
  session: StoredSession,
  store: PlannerStore,
  tokens: ZoneTokens = pinnedTokens,
  signal: { aborted: boolean } = { aborted: false },
): Promise<CycleReport> {
  const { api, keys: keyStore } = services;
  const now = () => services.now();
  const state: SyncState = (await keyStore.loadSyncState()) ?? emptySyncState();
  const report: CycleReport = { uploaded: 0, received: 0, devices: 0, waitingForKeys: [], stranded: [], needsApproval: false, keysPending: [], quarantined: 0, dropped: [], trashedEdits: [], failed: [], skipped: [] };

  const alive = () => {
    if (signal.aborted) throw new Aborted();
  };

  /** Saves the sync state, unless the pass was stopped or the device forgotten (both under the engine's lock, so a forget can't come between). */
  const save = async () => {
    alive();
    await services.engine.exclusive(async () => {
      alive();
      if (!(await keyStore.loadKeys())) throw new Aborted(); // forgotten: the state must not come back
      await keyStore.saveSyncState(state);
    });
  };

  const withEngine = async <T>(fn: (e: Engine) => T): Promise<T> => {
    alive();
    const result = await services.engine.run(
      session,
      (e) => {
        if (!e.sync) throw new SyncError("sync_unavailable", "This build can't sync: the engine's module isn't loaded.");
        return fn(e as Engine);
      },
    );
    alive();
    return result;
  };

  /**
   * The records an `Applied` changed, as the store should have them. `types` holds the record types the
   * server reported for a page (not authenticated: they are only checked against what the zone allows).
   */
  /** The type of the local record with this id that belongs to the zone, if there is one. */
  function localTypeOf(zone: string, id: string): string | undefined {
    const s = store.getState();
    for (const [type, list] of [["task", s.tasks], ["list", s.lists], ["event", s.events], ["calendar", s.calendars], ["project", s.projects], ["tag", s.tags]] as const) {
      const found = (list as readonly { id: string; listId?: string; calendarId?: string }[]).find((r) => r.id === id);
      if (found && zoneOf(type, found) === zone) return type;
    }
    return undefined;
  }

  /** Records removed by someone else's delete whose unsent outbox entries must go with them. */
  const dropped: { type: RecordType; id: string }[] = [];

  /** What the person calls a local record, for a notice. */
  function titleOf(type: RecordType, id: string): string {
    const found = (store.getState()[STORE_KEY[type]] as readonly { id: string; title?: string; name?: string }[]).find((r) => r.id === id);
    return found?.title ?? found?.name ?? "An item";
  }

  function collect(e: Engine, zone: string, applied: Applied, options: { retried?: boolean; types?: Map<string, string> } = {}): RemoteChange[] {
    const out: RemoteChange[] = [];
    const outbox = new Map(store.getState().outbox.map((o) => [refKey(o), o] as const));
    const rejected: string[] = [];
    for (const id of applied.changed) {
      const json = e.sync.record(zone, id);
      if (!json) continue;
      const record = parse<{ record_type: string; fields: StampedFields }>(json);
      let fields = valuesOf(record.fields);
      const type = acceptable(zone, id, record.record_type, fields, options.types?.get(id));
      if (!type) {
        rejected.push(id); // not what this zone may hold: quarantined, never applied
        continue;
      }
      const key = refKey({ type, id });
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
      // The engine has no record to name a type for: the server's type for the page, or the local record's.
      const type = acceptable(zone, id, options.types?.get(id) ?? localTypeOf(zone, id), null, options.types?.get(id));
      if (!type) {
        rejected.push(id);
        continue;
      }
      // A create that was never acknowledged exists nowhere else: it is not a remote delete's to take, it is staged and sent.
      if (outbox.get(refKey({ type, id }))?.op === "create") continue;
      // Delete wins over edits, everywhere: a record that was on the server and is now gone (another device deleted it, or a
      // refetch found it purged) stays in the engine's 30-day trash with this device's unsent edits, and its outbox entry is
      // dropped with the record, not uploaded. The person is told. (An unsent create is different: the server never had it,
      // so it is skipped above and goes up.)
      const waiting = outbox.get(refKey({ type, id }));
      if (waiting && applied.trashed.includes(id) && !(waiting.op === "delete" && Object.keys(waiting.changedFields).length === 0)) {
        report.trashedEdits.push(titleOf(type, id));
        // Its outbox entry goes in the same step as the record: left, the next pass would stage its partial fields and
        // recreate a fragment of the deleted record. (An entry whose upload landed and was answered is a create here too: the
        // record was on the server, so it is deleted like any other. A hard delete is the person's own and is left alone.)
        dropped.push({ type, id });
      }
      // A record that moved to another list is deleted from the old zone and made in the new one: the delete mustn't win.
      if ((state.zoneOf[refKey({ type, id })] ?? zone) === zone) out.push({ type, id, fields: null });
    }
    // Quarantine: what could not be opened or was rejected, less what has opened since.
    // A retry lists exactly what is still unopened; a fetch adds to what was waiting.
    const waiting = new Set(options.retried ? [] : (state.quarantined[zone] ?? []));
    // What the engine could not open (or found invalid), from its own list, besides what this side rejected.
    for (const q of parse<{ record_id: string; reason: string }[]>(e.sync.quarantined(zone))) waiting.add(q.record_id);
    for (const id of [...applied.quarantined, ...rejected]) waiting.add(id);
    for (const id of [...applied.changed, ...applied.removed, ...applied.evicted]) if (!rejected.includes(id)) waiting.delete(id);
    if (waiting.size > 0) state.quarantined[zone] = [...waiting];
    else delete state.quarantined[zone];
    return out;
  }

  async function show(changes: RemoteChange[]): Promise<void> {
    if (changes.length === 0) return;
    alive();
    report.received += changes.length;
    await store.applyRemote(changes);
    if (dropped.length > 0) {
      const gone = dropped.splice(0);
      const entries = store
        .getState()
        .outbox.filter((o) => gone.some((g) => g.type === o.type && g.id === o.id) && !(o.op === "delete" && Object.keys(o.changedFields).length === 0))
        .map((o) => ({ type: o.type, id: o.id, idempotencyKey: o.idempotencyKey }));
      await store.acknowledge(entries);
      for (const g of gone) {
        delete state.staged[refKey(g)];
        delete state.stagedZone[refKey(g)];
      }
    }
  }

  // 0. Stage the outbox ------------------------------------------------------------------------------------
  // First, before anything is fetched: the engine's clock moves past every stamp it receives, so an edit
  // staged after a fetch would be stamped later than edits other devices made after it. Staged now, each field
  // carries the time it was edited, and merging with what arrives decides field by field.
  const entries = store.getState().outbox.filter((o) => state.staged[refKey(o)] !== o.idempotencyKey && !state.failed[refKey(o)]?.startsWith(`${o.idempotencyKey}|`));
  if (entries.length > 0) {
    await withEngine((e) => {
      for (const entry of entries) stage(e, entry);
    });
    await save();
  }

  /** When each field of an entry was edited; an entry from before per-field times has only `updatedAt`. */
  function fieldTimesOf(entry: OutboxEntry): Record<string, string> {
    return Object.fromEntries(Object.keys(entry.changedFields).map((name) => [name, entry.fieldTimes?.[name] ?? entry.updatedAt]));
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
      const times = fieldTimesOf(entry);
      if (previous && previous !== zone) {
        // A task moved to another list: it is deleted from the old zone and made whole in the new one.
        e.sync.delete(previous, entry.id);
        const whole = storedOf(entry.type, here as never) as unknown as Record<string, unknown>;
        for (const name of Object.keys(whole)) if (!(name in times)) times[name] = entry.createdAt;
        fields = { ...whole, ...fields };
      }
      // Each field is staged with the time it was edited: fields edited together share a stamp, and an older
      // edit never takes the time of a later edit of another field.
      const groups = new Map<string, Record<string, unknown>>();
      for (const [name, value] of Object.entries(fields)) {
        const at = times[name] ?? entry.updatedAt;
        groups.set(at, { ...groups.get(at), [name]: value });
      }
      const staged: { fields: Record<string, unknown>; at: string }[] = [...groups].sort((x, y) => Date.parse(x[0]) - Date.parse(y[0])).map(([at, f]) => ({ fields: f, at }));
      if (JSON.stringify(staged.map((g) => g.fields)).length > MAX_RECORD_BYTES) {
        // Too large to send: marked, shown, and left out of every upload; the rest of the outbox goes on.
        state.failed[key] = `${entry.idempotencyKey}|It is too large to sync.`; // until the record is edited again
        return;
      }
      for (const group of staged) {
        const stamp = parse<Stamp>(e.sync.tickAt(Date.parse(group.at) || now(), now()));
        e.sync.stage(zone, entry.type, entry.id, JSON.stringify(stampFields(group.fields, stamp)));
      }
      state.zoneOf[key] = zone;
    }
    state.staged[key] = entry.idempotencyKey;
    state.stagedZone[key] = zone;
  }

  // 1. Devices, and the keys other devices sent --------------------------------------------------------
  const devices: DeviceList = await api.devices();
  const verified = await withEngine((e) => e.verifyDevices(devices));
  report.devices = devices.devices.filter((d) => d.state === "trusted").length;
  const owes = [...verified].sort().join(",");
  // A device that was approved again (it lost its saved state and holds no keys) is in the trusted set already, so the
  // set didn't change. Its approval did: every trusted device then sends it every zone key it holds, not just the approver.
  state.approvals ??= {};
  state.resentAt ??= {};
  let reapproved = false;
  for (const d of devices.devices) {
    if (d.state !== "trusted" || d.id === session.deviceId) continue;
    const marker = d.approval_id ?? d.approval_signature ?? "";
    const seen = state.approvals[d.id];
    if (seen === undefined) {
      state.approvals[d.id] = marker;
    } else if (seen !== marker) {
      // At most once per ten minutes per device, so a server that changes the value on every poll can't make every pass resend
      // every key. A throttled change is not recorded, so it is acted on once the ten minutes are up.
      if (now() - (state.resentAt[d.id] ?? 0) >= RESEND_EVERY_MS) {
        reapproved = true;
        state.resentAt[d.id] = now();
        state.approvals[d.id] = marker;
      }
    }
  }
  if (reapproved) state.keysSent = {};
  const envelopes = await api.keyEnvelopes();
  if (envelopes.envelopes.length > 0) {
    const opened = await withEngine((e) => {
      const accepted = parse<Accepted>(e.sync.acceptEnvelopes(JSON.stringify(envelopes), JSON.stringify(devices)));
      return accepted.zones.map((zone) => ({ zone, changes: collect(e, zone, parse<Applied>(e.sync.retryQuarantined(zone, now())), { retried: true }) }));
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
        } catch (again) {
          // Started over and refused again: there is nothing more to do now, and saying so beats a raw engine code.
          if (hasCode(again, "expired_again")) throw new SyncError("token_expired", "The server keeps refusing this device's place in a list or calendar, even when it starts over. Try again later.");
          throw again;
        }
        continue; // restarted: fetch the zone again from the start
      }
      const types = new Map(body.records.map((r) => [r.record_id, r.record_type] as const));
      const changes = await withEngine((e) => collect(e, zone, tokens.applyPage(e, zone, since, body, now()), { types }));
      await show(changes);
      await save();
      if (!body.more) break;
    }
  }

  // 4. The keys this device owes the others ----------------------------------------------------------------
  /** Sends a zone's keys to the trusted devices and records that the server took them. "nokey": this device has none yet. */
  async function sendKeys(zone: string): Promise<"sent" | "nokey" | "failed"> {
    const put = await withEngine((e) => {
      try {
        return e.sync.envelopesFor(zone, JSON.stringify(devices));
      } catch (error) {
        if (hasCode(error, "no_zone_key")) return null;
        throw error;
      }
    });
    if (put === null) return "nokey";
    try {
      if (parse<{ envelopes: unknown[] }>(put).envelopes.length > 0) await api.putKeyEnvelopes(parse(put));
    } catch (error) {
      if (error instanceof ApiFailure && error.status >= 400 && error.status < 500 && error.status !== 401 && error.status !== 429) {
        report.keysPending.push(zone); // refused (a device was removed meanwhile, say): tried again next pass
        return "failed";
      }
      throw error;
    }
    state.keysSent[zone] = owes;
    await save();
    return "sent";
  }

  for (const zone of state.zones) {
    if (state.keysSent[zone] !== owes) await sendKeys(zone);
  }

  // 5. Send it -------------------------------------------------------------------------------------------------
  const sentZones = new Set<string>();
  let transient: unknown = null;
  for (const zone of [...state.zones]) {
    if ((state.backoff[zone]?.until ?? 0) > now()) {
      report.skipped.push(zone);
      continue;
    }
    try {
      if (await uploadZone(zone)) {
        sentZones.add(zone);
        delete state.backoff[zone];
      }
    } catch (error) {
      if (error instanceof Aborted) throw error;
      if (error instanceof ApiFailure && error.code === "zone_deleted") {
        await dropZone(zone);
        continue;
      }
      if (error instanceof ApiFailure && error.status >= 400 && error.status < 500 && error.status !== 401 && error.status !== 429) {
        // Refused for good this time (too large, not allowed): this zone waits a while, the others go on.
        await withEngine((e) => e.sync.abandonUpload(zone));
        const step = Math.min((state.backoff[zone]?.step ?? BACKOFF_FIRST_MS / 2) * 2, BACKOFF_MAX_MS);
        state.backoff[zone] = { until: now() + step, step };
        report.skipped.push(zone);
        continue;
      }
      if (hasCode(error, "record_too_large")) {
        const step = Math.min((state.backoff[zone]?.step ?? BACKOFF_FIRST_MS / 2) * 2, BACKOFF_MAX_MS);
        state.backoff[zone] = { until: now() + step, step };
        report.skipped.push(zone);
        continue;
      }
      // The network, the server or a rate limit: stop sending, but still clear what was acknowledged.
      transient = error;
      break;
    }
  }

  /** Uploads a zone until it has nothing dirty. True when it is all sent. */
  async function uploadZone(zone: string): Promise<boolean> {
    for (let batch = 0; batch < MAX_BATCHES; batch++) {
      alive();
      let upload: string | undefined;
      try {
        upload = await withEngine((e) => e.sync.buildUpload(zone));
      } catch (error) {
        if (!hasCode(error, "no_zone_key")) throw error;
        if (serverZones.get(zone)?.deleted) {
          // Deleted for the account (even one this device can't open): delete wins, the unsent changes go.
          await dropZone(zone);
          return true;
        }
        if (!state.made[zone] && serverZones.has(zone)) {
          // It exists and another device holds its key: wait for the envelope, visibly.
          report.waitingForKeys.push(zone);
          return false;
        }
        // A zone nobody has made, or one this device made and lost the key of: the key is made here first and
        // remembered, then the zone is made, so a crash between the two leaves a key and no stranded zone.
        await withEngine((e) => e.sync.createZoneKey(zone));
        state.made[zone] = true;
        delete state.keysSent[zone];
        await save();
        if (!serverZones.has(zone)) serverZones.set(zone, await api.createZone(zone));
        continue;
      }
      if (upload === undefined) return true;
      // Nothing goes up until the other devices have the keys: a notice that reached them first would find a zone they can't open.
      if (state.keysSent[zone] !== owes && (await sendKeys(zone)) !== "sent") return false;
      const body = parse<UploadChanges>(upload);
      try {
        const result: UploadResult = await api.upload(zone, body);
        await withEngine((e) => e.sync.uploadSucceeded(zone, JSON.stringify(result)));
        report.uploaded += body.changes.length;
      } catch (error) {
        if (tokens.isExpired(error)) {
          // The server no longer knows the place this device uploaded from: start the zone over, and fetch it again next.
          await withEngine((e) => {
            e.sync.abandonUpload(zone);
            tokens.restart(e, zone);
          });
          return false;
        }
        if (error instanceof ApiFailure && error.code === "zone_not_found") {
          // This device has the key but the zone was never made (a crash between): make it, and send again.
          serverZones.set(zone, await api.createZone(zone));
          continue;
        }
        if (error instanceof ApiFailure && error.code === "record_changed") {
          // Someone changed those records first: merge their copies and send again.
          const conflict = error.body as RecordChanged;
          const types = new Map(conflict.conflicts.flatMap((c) => (c.server_record ? [[c.record_id, c.server_record.record_type] as const] : [])));
          const changes = await withEngine((e) => collect(e, zone, parse<Applied>(e.sync.uploadConflicted(zone, JSON.stringify(conflict), now())), { types }));
          await show(changes);
          continue;
        }
        throw error;
      }
    }
    return false;
  }

  /** A list or calendar was deleted on another device: the delete wins. Its local records and unsent changes are dropped, and the person is told. */
  async function dropZone(zone: string): Promise<void> {
    const mine: { type: RecordType; id: string }[] = [];
    const s = store.getState();
    for (const [type, list] of [["task", s.tasks], ["list", s.lists], ["event", s.events], ["calendar", s.calendars], ["project", s.projects], ["tag", s.tags]] as const) {
      for (const r of list as readonly { id: string; listId?: string; calendarId?: string; isInbox?: boolean; kind?: { type: string } }[]) {
        // The inbox and the personal calendar are the planner's own: they stay, and make their zone again.
        if (r.isInbox || (type === "calendar" && r.kind?.type === "local" && r.id === zone.slice(zone.indexOf(":") + 1))) continue;
        if (zoneOf(type, r) === zone) mine.push({ type, id: r.id });
      }
    }
    await withEngine((e) => e.sync.abandonUpload(zone));
    alive();
    await show(mine.map((m) => ({ ...m, fields: null })));
    const sentKeys = store
      .getState()
      .outbox.filter((o) => mine.some((m) => m.type === o.type && m.id === o.id))
      .map((o) => ({ type: o.type, id: o.id, idempotencyKey: o.idempotencyKey }));
    await store.acknowledge(sentKeys);
    for (const m of mine) {
      delete state.staged[refKey(m)];
      delete state.stagedZone[refKey(m)];
      delete state.zoneOf[refKey(m)];
    }
    state.zones = state.zones.filter((z) => z !== zone);
    delete state.keysSent[zone];
    delete state.made[zone];
    delete state.quarantined[zone];
    report.dropped.push({ zone, records: mine.length });
  }

  // 6. Clear what was acknowledged ------------------------------------------------------------------------
  alive();
  const sent = store
    .getState()
    .outbox.filter((o) => state.staged[refKey(o)] === o.idempotencyKey && (state.stagedZone[refKey(o)] === undefined || sentZones.has(state.stagedZone[refKey(o)]!)))
    .map((o) => ({ type: o.type, id: o.id, idempotencyKey: o.idempotencyKey }));
  await store.acknowledge(sent);
  for (const s of sent) {
    delete state.staged[refKey(s)];
    delete state.stagedZone[refKey(s)];
  }

  // A failure belongs to one version of the record: once it has been edited again it is tried again.
  const current = new Map(store.getState().outbox.map((o) => [refKey(o), o.idempotencyKey] as const));
  for (const [key, value] of Object.entries(state.failed)) if (current.get(key) !== value.slice(0, value.indexOf("|"))) delete state.failed[key];
  report.failed = Object.entries(state.failed).map(([key, value]) => ({ type: key.slice(0, key.indexOf(":")) as RecordType, id: key.slice(key.indexOf(":") + 1), reason: value.slice(value.indexOf("|") + 1) }));
  // What this device can't open, and why. The server lists other trusted devices that this device doesn't trust (its engine
  // was reset: it trusts only itself): it has to be approved again before anyone can send it keys, and until then nothing is
  // called waiting or stranded, since another device can read those zones. Only when BOTH this device's own trust view and the
  // server's list show no other trusted device can nobody hold a key, and a zone it can't open is stranded.
  const othersInView = [...verified].some((id) => id !== session.deviceId);
  const othersOnServer = devices.devices.some((d) => d.state === "trusted" && d.id !== session.deviceId);
  if (!othersInView && (othersOnServer || state.reset)) {
    // A device whose saved state was reset says so until it has been approved again once, whatever the server's list shows: a
    // server that hides the others must not be able to make this look like the account's only device.
    report.needsApproval = true;
    report.waitingForKeys = [];
  } else if (!othersInView && !othersOnServer) {
    const closed = new Set([...report.waitingForKeys, ...Object.entries(state.quarantined).filter(([, ids]) => ids.length > 0).map(([zone]) => zone)]);
    report.stranded = [...closed].filter((zone) => serverZones.has(zone) && !serverZones.get(zone)!.deleted && !state.made[zone]).sort();
  }
  report.quarantined = Object.values(state.quarantined).reduce((n, ids) => n + ids.length, 0);
  if (transient === null) state.lastSyncedAt = new Date(now()).toISOString();
  await save();
  if (transient !== null) throw transient;
  return report;
}

/** A device whose approval changed gets the keys again at most this often (unless an approval completed on this device). */
const RESEND_EVERY_MS = 10 * 60 * 1000;

const STORE_KEY = { task: "tasks", list: "lists", event: "events", calendar: "calendars", project: "projects", tag: "tags" } as const satisfies Record<RecordType, string>;

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && error.message.startsWith(`${code}:`);
}

/**
 * Deletes a zone for the whole account through the normal signed delete: for a zone no device can open, which
 * would otherwise wait for a key that will never come. The next pass drops what this device still had for it.
 */
export async function removeZone(services: AuthServices, session: StoredSession, zone: string): Promise<void> {
  const proof = await services.engine.run(session, (e) => {
    if (!e.sync) throw new SyncError("sync_unavailable", "This build can't sync: the engine's module isn't loaded.");
    return (e as Engine).sync.deleteZoneProof(zone);
  });
  await services.api.deleteZone(zone, JSON.parse(proof));
}
