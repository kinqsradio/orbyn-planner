import type { KeyRotation } from "../../generated/KeyRotation";
import type { Record as ServerRecord } from "../../generated/Record";
import type { RecordChange } from "../../generated/RecordChange";
import type { UploadChanges } from "../../generated/UploadChanges";
import { decodeBytes, encodeBytes } from "../bytes";

/** One zone as the mock server keeps it. */
export interface MockZone {
  name: string;
  id: number;
  sequence: number;
  deleted: boolean;
  createdAt: string;
  records: Map<string, ServerRecord>;
  /** The sequence each record last changed at, for "changes since". */
  changedAt: Map<string, number>;
  operations: Map<string, { hash: string; result: unknown }>;
}

export interface MockEnvelope {
  sender_device_id: string;
  recipient_device_id: string;
  zone: string;
  key_id: string;
  envelope: string;
  created_at: string;
  rotation?: KeyRotation;
}

/** The account's slice of the mock record store: zones and key envelopes. */
export interface MockRecords {
  zones: Map<string, MockZone>;
  envelopes: MockEnvelope[];
  nextZoneId: number;
}

export const newMockRecords = (): MockRecords => ({ zones: new Map(), envelopes: [], nextZoneId: 1 });

const token = (z: MockZone, sequence = z.sequence) => {
  const out = new Uint8Array(24);
  new DataView(out.buffer).setUint32(12, z.id, false);
  new DataView(out.buffer).setBigUint64(16, BigInt(sequence), false);
  return encodeBytes(out);
};

function sequenceOf(z: MockZone, text: string): number | null {
  try {
    const bytes = decodeBytes(text);
    if (bytes.length !== 24) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset);
    if (view.getUint32(12, false) !== z.id) return null;
    const sequence = Number(view.getBigUint64(16, false));
    return sequence > z.sequence ? null : sequence;
  } catch {
    return null;
  }
}

const json = (status: number, body: unknown) => new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const fail = (status: number, code: string, message: string) => json(status, { code, message });

export interface RecordStoreContext {
  records: MockRecords;
  /** Devices of the account that are trusted right now. */
  trustedDevices: string[];
  deviceId: string;
  now: () => number;
  /** Called after each write, with the zone and its new token: the server's live notice. */
  notify?: (zone: string, token: string, author: string) => void;
}

/** The record store's routes. Returns null for a path that isn't one of them. */
export function recordStoreRoute(ctx: RecordStoreContext, method: string, rawPath: string, body: unknown): Response | null {
  const [path, query = ""] = rawPath.split("?");
  const params = new URLSearchParams(query);
  const { records } = ctx;

  if (method === "GET" && path === "/v1/zones") {
    const after = params.get("after");
    const all = [...records.zones.values()].sort((a, b) => a.name.localeCompare(b.name)).filter((z) => !after || z.name > after);
    const page = all.slice(0, 500);
    return json(200, {
      zones: page.map((z) => ({ zone: z.name, token: token(z), deleted: z.deleted, created_at: z.createdAt })),
      ...(all.length > 500 ? { next: page.at(-1)!.name } : {}),
    });
  }

  let m = /^\/v1\/zones\/([^/]+)$/.exec(path!);
  if (m && method === "PUT") {
    const name = decodeURIComponent(m[1]!);
    if (name.length < 1 || name.length > 64) return fail(400, "invalid_request", "A zone name is 1 to 64 characters.");
    let z = records.zones.get(name);
    if (!z) {
      z = { name, id: records.nextZoneId++, sequence: 0, deleted: false, createdAt: new Date(ctx.now()).toISOString(), records: new Map(), changedAt: new Map(), operations: new Map() };
      records.zones.set(name, z);
    } else if (z.deleted) {
      z.deleted = false;
      z.sequence += 1;
    }
    return json(200, { zone: z.name, token: token(z), deleted: z.deleted, created_at: z.createdAt });
  }

  m = /^\/v1\/zones\/([^/]+)\/changes$/.exec(path!);
  if (m) {
    const z = records.zones.get(decodeURIComponent(m[1]!));
    if (!z) return fail(404, "zone_not_found", "No such zone.");
    if (method === "GET") {
      const since = params.get("since");
      const from = since ? sequenceOf(z, since) : 0;
      if (from === null) return fail(400, "invalid_change_token", "That change token is not valid.");
      const limit = Math.min(Math.max(Number(params.get("limit") ?? 200), 1), 200);
      const changed = [...z.changedAt.entries()].filter(([, at]) => at > from).sort((a, b) => a[1] - b[1]);
      const page = changed.slice(0, limit);
      const last = page.at(-1)?.[1] ?? from;
      return json(200, { records: page.map(([id]) => z.records.get(id)!), token: token(z, page.length === changed.length ? z.sequence : last), more: page.length < changed.length, zone_deleted: z.deleted });
    }
    if (method === "POST") {
      if (z.deleted) return fail(410, "zone_deleted", "That zone was deleted.");
      const upload = body as UploadChanges;
      const hash = JSON.stringify(upload.changes);
      const seen = z.operations.get(upload.operation_id);
      if (seen) return seen.hash === hash ? json(200, { ...(seen.result as object), replayed: true }) : fail(409, "operation_reused", "That operation id was used for another batch.");
      const conflicts: { record_id: string; server_record: ServerRecord | null }[] = [];
      for (const c of upload.changes) {
        const current = z.records.get(c.record_id) ?? null;
        const expected = c.expected_version;
        if ((current?.version ?? null) !== expected) conflicts.push({ record_id: c.record_id, server_record: current });
      }
      if (conflicts.length > 0) return json(409, { code: "record_changed", message: "Records changed.", conflicts });
      z.sequence += 1;
      const at = new Date(ctx.now()).toISOString();
      const saved = upload.changes.map((c: RecordChange) => {
        const type = c.op === "save" ? c.record_type : (z.records.get(c.record_id)?.record_type ?? "item");
        const record: ServerRecord =
          c.op === "save"
            ? { record_id: c.record_id, record_type: type, version: z.sequence, ciphertext: c.ciphertext, wrapped_key: c.wrapped_key, author_device_id: ctx.deviceId, modified_at: at, deleted: false }
            : { record_id: c.record_id, record_type: type, version: z.sequence, ciphertext: null, wrapped_key: null, author_device_id: ctx.deviceId, modified_at: at, deleted: true, ...(c.proof ? { delete_proof: c.proof } : {}) };
        z.records.set(c.record_id, record);
        z.changedAt.set(c.record_id, z.sequence);
        return { record_id: c.record_id, record_type: type, version: z.sequence, deleted: record.deleted };
      });
      const result = { token: token(z), modified_at: at, records: saved, replayed: false };
      z.operations.set(upload.operation_id, { hash, result });
      ctx.notify?.(z.name, token(z), ctx.deviceId);
      return json(200, result);
    }
  }

  if (path === "/v1/keychain/envelopes") {
    if (method === "GET") {
      const mine = records.envelopes.filter((e) => e.recipient_device_id === ctx.deviceId && ctx.trustedDevices.includes(e.sender_device_id));
      return json(200, { envelopes: mine.map(({ recipient_device_id: _r, ...rest }) => (void _r, rest)) });
    }
    if (method === "POST") {
      const put = body as { envelopes: (Omit<MockEnvelope, "sender_device_id" | "created_at">)[] };
      for (const e of put.envelopes) {
        if (!ctx.trustedDevices.includes(e.recipient_device_id) || e.recipient_device_id === ctx.deviceId) return fail(400, "recipient_not_trusted", "That device can't receive a key.");
      }
      for (const e of put.envelopes) {
        const at = records.envelopes.findIndex((x) => x.recipient_device_id === e.recipient_device_id && x.zone === e.zone && x.key_id === e.key_id);
        const next: MockEnvelope = { ...e, sender_device_id: ctx.deviceId, created_at: new Date(ctx.now()).toISOString() };
        if (at >= 0) records.envelopes[at] = next;
        else records.envelopes.push(next);
      }
      return json(204, null);
    }
  }
  return null;
}
