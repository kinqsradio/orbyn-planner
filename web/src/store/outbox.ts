import type { CalendarEvent, OutboxEntry, PlannerCalendar, Project, RecordType, Tag, Task, TaskList } from "./types";

export type AnyRecord = Task | TaskList | CalendarEvent | PlannerCalendar | Project | Tag;

/** One change to one record: a create carries the record, an update or delete only the fields that changed. */
export type Patch =
  | { type: RecordType; id: string; op: "create"; record: AnyRecord; key: string; local?: boolean }
  | { type: RecordType; id: string; op: "update" | "delete"; fields: Record<string, unknown>; key: string; local?: boolean }
  | { type: RecordType; id: string; op: "purge"; key: string; local?: boolean };

export interface PatchBatch {
  /** ISO time of the change. */
  at: string;
  patches: Patch[];
}

export interface Ref {
  type: RecordType;
  id: string;
}

export const refKey = (r: Ref) => `${r.type}:${r.id}`;

/** What to do to the outbox for one patch: remove an entry, and write one (seq 0 means a new entry). */
export interface OutboxChange {
  remove?: number;
  write?: OutboxEntry;
}

/**
 * Folds a patch into the record's outbox entry, so there is one entry per record.
 * - A create stays a create while it is pending, however it is edited.
 * - Other edits merge their fields, the latest value winning.
 * - Every fold takes the new patch's idempotency key, so a changed entry is never
 *   mistaken on the server for a repeat of what was sent before.
 * - A purge of a record that was never synced (a pending create) removes its
 *   entry and sends nothing; otherwise it leaves one delete entry.
 */
export function coalesce(existing: OutboxEntry | undefined, patch: Patch, at: string): OutboxChange {
  const timesOf = (fields: Record<string, unknown>) => Object.fromEntries(Object.keys(fields).map((name) => [name, at]));
  const fresh = (op: OutboxEntry["op"], changedFields: Record<string, unknown>): OutboxEntry => ({
    seq: 0,
    type: patch.type,
    id: patch.id,
    op,
    changedFields,
    fieldTimes: timesOf(changedFields),
    idempotencyKey: patch.key,
    createdAt: at,
    updatedAt: at,
  });

  if (patch.op === "create") {
    return existing ? {} : { write: fresh("create", { ...patch.record }) };
  }
  if (patch.op === "purge") {
    if (existing?.op === "create") return { remove: existing.seq };
    if (existing?.op === "delete") return { write: { ...existing, changedFields: {}, fieldTimes: {}, idempotencyKey: patch.key, updatedAt: at } };
    return { remove: existing?.seq, write: fresh("delete", {}) };
  }
  if (!existing) return { write: fresh(patch.op, { ...patch.fields }) };
  return {
    write: {
      ...existing,
      op: existing.op === "create" ? "create" : patch.op,
      changedFields: { ...existing.changedFields, ...patch.fields },
      // Each field keeps the time of its own last edit; fields of an older entry take its updatedAt.
      fieldTimes: { ...Object.fromEntries(Object.keys(existing.changedFields).map((name) => [name, existing.updatedAt])), ...existing.fieldTimes, ...timesOf(patch.fields) },
      idempotencyKey: patch.key,
      updatedAt: at,
    },
  };
}
