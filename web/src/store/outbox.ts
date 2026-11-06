import type { OutboxEntry, RecordType, Task, TaskList } from "./types";

/** One change to one record: a create carries the record, an update or delete only the fields that changed. */
export type Patch =
  | { type: RecordType; id: string; op: "create"; record: Task | TaskList; key: string }
  | { type: RecordType; id: string; op: "update" | "delete"; fields: Record<string, unknown>; key: string }
  | { type: RecordType; id: string; op: "purge"; key: string };

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
 * - Other edits merge their fields, the latest value winning, and keep the entry's idempotency key.
 * - A purge removes a pending create or update and leaves one delete entry.
 */
export function coalesce(existing: OutboxEntry | undefined, patch: Patch, at: string): OutboxChange {
  const fresh = (op: OutboxEntry["op"], changedFields: Record<string, unknown>): OutboxEntry => ({
    seq: 0,
    type: patch.type,
    id: patch.id,
    op,
    changedFields,
    idempotencyKey: patch.key,
    createdAt: at,
    updatedAt: at,
  });

  if (patch.op === "create") {
    return existing ? {} : { write: fresh("create", { ...patch.record }) };
  }
  if (patch.op === "purge") {
    if (existing?.op === "delete") return { write: { ...existing, changedFields: {}, updatedAt: at } };
    return { remove: existing?.seq, write: fresh("delete", {}) };
  }
  if (!existing) return { write: fresh(patch.op, { ...patch.fields }) };
  return {
    write: {
      ...existing,
      op: existing.op === "create" ? "create" : patch.op,
      changedFields: { ...existing.changedFields, ...patch.fields },
      updatedAt: at,
    },
  };
}
