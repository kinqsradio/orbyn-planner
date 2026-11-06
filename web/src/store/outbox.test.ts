import { describe, expect, it } from "vitest";
import { coalesce, type Patch } from "./outbox";
import type { OutboxEntry, Task } from "./types";

const AT1 = "2026-11-07T10:00:00.000Z";
const AT2 = "2026-11-07T11:00:00.000Z";
const task = { id: "t1", title: "a" } as Task;

const create: Patch = { type: "task", id: "t1", op: "create", record: task, key: "k1" };
const update = (fields: Record<string, unknown>, key = "k2"): Patch => ({ type: "task", id: "t1", op: "update", fields, key });
const del: Patch = { type: "task", id: "t1", op: "delete", fields: { deletedAt: AT2 }, key: "k3" };
const purge: Patch = { type: "task", id: "t1", op: "purge", key: "k4" };

describe("coalesce", () => {
  it("a create makes an entry holding the whole record", () => {
    expect(coalesce(undefined, create, AT1)).toEqual({
      write: { seq: 0, type: "task", id: "t1", op: "create", changedFields: task, fieldTimes: { id: AT1, title: AT1 }, idempotencyKey: "k1", createdAt: AT1, updatedAt: AT1 },
    });
  });

  it("an update with nothing pending makes an update entry with only the changed fields", () => {
    const { write } = coalesce(undefined, update({ title: "b" }), AT1);
    expect(write).toMatchObject({ op: "update", changedFields: { title: "b" }, idempotencyKey: "k2", createdAt: AT1 });
  });

  it("folds later edits into the entry, latest value winning, with a new key and the first creation time", () => {
    const first = coalesce(undefined, update({ title: "b", notes: "n" }), AT1).write!;
    const entry = { ...first, seq: 7 };
    const { write } = coalesce(entry, update({ title: "c" }, "k9"), AT2);
    // Each field keeps the time of its own last edit: the notes were not touched at AT2.
    expect(write).toEqual({ ...entry, changedFields: { title: "c", notes: "n" }, fieldTimes: { title: AT2, notes: AT1 }, idempotencyKey: "k9", updatedAt: AT2 });
  });

  it("an entry that is still a create stays a create, however it is edited or deleted", () => {
    const entry = { ...coalesce(undefined, create, AT1).write!, seq: 3 };
    const edited = coalesce(entry, update({ title: "b" }), AT2).write!;
    expect(edited).toMatchObject({ op: "create", changedFields: { id: "t1", title: "b" } });
    expect(edited.idempotencyKey).not.toBe("k1");
    const deleted = coalesce({ ...edited, seq: 3 }, del, AT2).write!;
    expect(deleted).toMatchObject({ op: "create", changedFields: { title: "b", deletedAt: AT2 } });
  });

  it("an update then a delete is a delete; a restore after that is an update again", () => {
    const upd = { ...coalesce(undefined, update({ title: "b" }), AT1).write!, seq: 4 };
    const deleted = { ...coalesce(upd, del, AT2).write!, seq: 4 };
    expect(deleted).toMatchObject({ op: "delete", changedFields: { title: "b", deletedAt: AT2 } });
    const restored = coalesce(deleted, update({ deletedAt: null }), AT2).write!;
    expect(restored).toMatchObject({ op: "update", changedFields: { deletedAt: null } });
  });

  it("a purge of a record that never synced removes its entry and sends nothing", () => {
    const entry = { ...coalesce(undefined, create, AT1).write!, seq: 5 };
    const out = coalesce(entry, purge, AT2);
    expect(out).toEqual({ remove: 5 });
  });

  it("a purge after an update leaves one delete entry", () => {
    const entry = { ...coalesce(undefined, update({ title: "b" }), AT1).write!, seq: 5 };
    const out = coalesce(entry, purge, AT2);
    expect(out.remove).toBe(5);
    expect(out.write).toMatchObject({ seq: 0, op: "delete", changedFields: {}, idempotencyKey: "k4" });
  });

  it("a purge after a delete keeps the one delete entry", () => {
    const deleted = { ...coalesce(undefined, del, AT1).write!, seq: 6 };
    const out = coalesce(deleted, purge, AT2);
    expect(out.remove).toBeUndefined();
    // The purge is new content, so it takes the purge's key.
    expect(out.write).toMatchObject({ seq: 6, op: "delete", changedFields: {}, idempotencyKey: "k4" });
  });

  it("a create for a record that already has an entry changes nothing", () => {
    const entry = { ...coalesce(undefined, create, AT1).write!, seq: 1 } satisfies OutboxEntry;
    expect(coalesce(entry, create, AT2)).toEqual({});
  });
});
