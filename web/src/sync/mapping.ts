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

/**
 * The record type of an id in a zone, which the engine doesn't return: the zone's own record (its id is
 * the zone's) is the list, project or calendar, and anything else in a list zone is a task and in a
 * calendar zone an event. The settings zone holds no planner records yet.
 */
export function typeIn(zone: string, id: string): RecordType | null {
  const [kind, owner] = [zone.slice(0, zone.indexOf(":")), zone.slice(zone.indexOf(":") + 1)];
  if (kind === "list") return id === owner ? "list" : "task";
  if (kind === "calendar") return id === owner ? "calendar" : "event";
  if (kind === "project") return id === owner ? "project" : null;
  return null;
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
