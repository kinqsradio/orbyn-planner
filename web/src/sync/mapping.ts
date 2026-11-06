import type { RecordType } from "../store/types";

/** A hybrid logical clock reading, as the engine writes it. */
export interface Stamp {
  millis: number;
  counter: number;
  device: number;
}

/** A record's fields as the engine keeps and uploads them: each with the stamp of its last edit. */
export type StampedFields = Record<string, { value: unknown; stamp: Stamp }>;

/** What the engine's `Applied` says changed, by record id (`orbyn-client`'s `Applied`). */
export interface Applied {
  changed: string[];
  removed: string[];
  trashed: string[];
  quarantined: string[];
  unverified_deletes: string[];
  evicted: string[];
  rejected: { record_id: string; fields: string[] }[];
  more: boolean;
}

export interface ZoneCheck {
  stale: string[];
  next?: string | null;
}

export interface Accepted {
  zones: string[];
  refused: { sender_device_id?: string; zone?: string; reason?: string }[];
}

/**
 * Zones: one per list, project and calendar (named by kind and id, so the name is the same on every
 * device), and one for the account's settings. A task lives in its list's zone and an event in its
 * calendar's, so a list and everything in it syncs, and is shared later, as a unit.
 */
export const SETTINGS_ZONE = "settings";
export const zoneName = (kind: "list" | "project" | "calendar", id: string) => `${kind}:${id}`;

/** The zone a record belongs in. A task needs its list; an event its calendar. */
export function zoneOf(type: RecordType, record: { id: string; listId?: string; calendarId?: string }): string {
  switch (type) {
    case "list":
      return zoneName("list", record.id);
    case "task":
      return zoneName("list", record.listId ?? record.id);
    case "project":
      return zoneName("project", record.id);
    case "calendar":
      return zoneName("calendar", record.id);
    case "event":
      return zoneName("calendar", record.calendarId ?? record.id);
  }
}

/** A zone's kind and the id of the list, project or calendar it belongs to. */
export function zoneParts(zone: string): { kind: string; owner: string } {
  const at = zone.indexOf(":");
  return at < 0 ? { kind: zone, owner: "" } : { kind: zone.slice(0, at), owner: zone.slice(at + 1) };
}

/** The record types a zone may hold: its own record (the id is the zone owner's) and what lives inside it. */
const ZONE_TYPES: Record<string, { owner: RecordType; inside: RecordType | null }> = {
  list: { owner: "list", inside: "task" },
  calendar: { owner: "calendar", inside: "event" },
  project: { owner: "project", inside: null },
};

/** Fields only a task or an event has: the record that is the zone itself never carries them. */
const OWNED_ONLY = ["listId", "calendarId", "done", "completedAt", "checklist", "start", "end", "allDay", "title"];

/**
 * Whether a record that arrived may be applied, and as what. The type is the engine's own (`record()` returns the
 * authenticated `record_type`); it is checked against where the record is, and anything else is rejected and
 * quarantined, never applied:
 *  - a calendar zone holds only events and the calendar itself, a list zone only tasks and the list, a project zone only the project;
 *  - a record whose id is the zone owner's is the owner kind, and only that;
 *  - the server's `record_type` for the page, when there is one, must be the engine's;
 *  - a task's `listId` and an event's `calendarId` must be the zone's owner;
 *  - the zone's own record must have a name and none of a task's or event's fields.
 * `type` is undefined for a removal, where the engine has no record: the server's type, or the local record's, stands in.
 */
export function acceptable(zone: string, id: string, type: string | undefined, fields: Record<string, unknown> | null, serverType?: string): RecordType | null {
  const { kind, owner } = zoneParts(zone);
  const allowed = ZONE_TYPES[kind];
  if (!allowed || type === undefined) return null;
  const isOwner = id === owner;
  if (isOwner ? type !== allowed.owner : type !== allowed.inside) return null;
  if (serverType !== undefined && serverType !== type) return null;
  if (fields) {
    if (type === "task" && fields.listId !== owner) return null;
    if (type === "event" && fields.calendarId !== owner) return null;
    if (isOwner && (typeof fields.name !== "string" || OWNED_ONLY.some((name) => name in fields))) return null;
  }
  return type as RecordType;
}

/** Stamps every field of an edit with one stamp. */
export function stampFields(fields: Record<string, unknown>, stamp: Stamp): StampedFields {
  const out: StampedFields = {};
  for (const [name, value] of Object.entries(fields)) {
    if (value !== undefined) out[name] = { value, stamp };
  }
  return out;
}

/** The plain values of a record's stamped fields; the engine's own `_deleted` marker is left out. */
export function valuesOf(fields: StampedFields): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, f] of Object.entries(fields)) if (name !== "_deleted") out[name] = f.value;
  return out;
}
