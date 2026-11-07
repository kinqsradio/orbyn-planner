// @vitest-environment node
import { describe, expect, it } from "vitest";
import { sanitizeFields, acceptable } from "../sync/mapping";
import { tagLabels } from "../features/tasks/TagChips";
import { LocalStore } from "./LocalStore";
import { MemoryPersistence } from "./persistence";
import { MAX_TAGS_PER_TASK, viewOf } from "./records";
import { DuplicateTagName, type Tag, type Task } from "./types";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const task = (fields: Record<string, unknown>) => ({ id: "t1", title: "Plan", listId: "inbox", ...fields });

describe("tag fields are validated on read and on the way in", () => {
  const many = Object.fromEntries(Array.from({ length: 105 }, (_, i) => [`tag:${id(i + 1)}`, true]));
  const cases: { name: string; fields: Record<string, unknown>; tags: string[] }[] = [
    { name: "a UUID-form id with true is a tag", fields: { [`tag:${id(1)}`]: true }, tags: [id(1)] },
    { name: "false removes, and is kept for a valid id", fields: { [`tag:${id(1)}`]: false }, tags: [] },
    { name: "an id that isn't UUID-form is ignored", fields: { "tag:work": true, "tag:": true, "tag:../x": true, [`tag:${id(2)}`]: true }, tags: [id(2)] },
    { name: "a value that isn't true or false is ignored", fields: { [`tag:${id(1)}`]: "yes", [`tag:${id(2)}`]: 1, [`tag:${id(3)}`]: null }, tags: [] },
    { name: "more than 100 tags: the first 100 by id stay", fields: many, tags: Array.from({ length: MAX_TAGS_PER_TASK }, (_, i) => id(i + 1)) },
  ];

  it.each(cases)("$name", ({ fields, tags }) => {
    // Read: the stored record gives only the trusted tags.
    expect((viewOf("task", task(fields) as never) as unknown as Task).tags).toEqual(tags);
    // In: fields from another device are cleaned, and the task is still accepted rather than quarantined.
    const kept = sanitizeFields("task", fields);
    expect(Object.keys(kept).filter((k) => k.startsWith("tag:") && kept[k] === true).sort()).toEqual(tags.map((t) => `tag:${t}`));
    expect(acceptable("list:inbox", "t1", "task", { listId: "inbox", ...kept })).toBe("task");
    // Other fields pass through untouched.
    expect(sanitizeFields("task", { title: "Plan", ...fields }).title).toBe("Plan");
  });
});

describe("tag names", () => {
  const tag = (n: number, name: string, deletedAt: string | null = null): Tag => ({ id: id(n), name, colour: "c1", deletedAt });

  async function store() {
    const s = new LocalStore({ persistence: new MemoryPersistence(), broadcast: false, now: () => new Date("2026-11-07T10:00:00Z") });
    await s.ready;
    return s;
  }

  const attempts: { name: string; run: (s: LocalStore) => void; blocked: boolean }[] = [
    { name: "making a tag with a name that exists", run: (s) => (s.addTag("Work", "c1"), s.addTag("Work", "c2")), blocked: true },
    { name: "the same name in another case, with spaces", run: (s) => (s.addTag("Work", "c1"), s.addTag("  wORK ", "c2")), blocked: true },
    { name: "renaming to another tag's name", run: (s) => { const a = s.addTag("Work", "c1"); const b = s.addTag("Home", "c2"); void a; s.updateTag(b.id, { name: "work" }); }, blocked: true },
    { name: "renaming a tag to its own name in another case", run: (s) => { const a = s.addTag("work", "c1"); s.updateTag(a.id, { name: "Work" }); }, blocked: false },
    { name: "a name that only a deleted tag has", run: (s) => { const a = s.addTag("Old", "c1"); s.deleteTag(a.id); s.addTag("Old", "c2"); }, blocked: false },
  ];

  it.each(attempts)("$name", ({ run, blocked }) => {
    return store().then((s) => {
      if (blocked) {
        expect(() => run(s)).toThrow(DuplicateTagName);
        expect(() => run(s)).toThrow("A tag with that name already exists.");
      } else {
        expect(() => run(s)).not.toThrow();
      }
    });
  });

  it("two synced tags with one name both show, the later one (by id) marked (2), then (3), and nothing is merged", () => {
    const tags = [tag(3, "Home"), tag(1, "Work"), tag(2, "work"), tag(4, "Home"), tag(5, "Old", "2026-11-01T00:00:00Z"), tag(6, "Old")];
    const labels = tagLabels(tags);
    expect(labels.get(id(1))).toBe("Work");
    expect(labels.get(id(2))).toBe("work (2)");
    expect(labels.get(id(3))).toBe("Home");
    expect(labels.get(id(4))).toBe("Home (2)");
    expect(labels.get(id(6))).toBe("Old"); // a deleted tag doesn't count
    expect(labels.has(id(5))).toBe(false);
    expect(labels.size).toBe(5);
  });
});

describe("a purged tag is cleared from a task when that task is next edited", () => {
  it("only the tasks that are edited lose the field, and the memory of the purge survives a reload", async () => {
    let now = new Date("2026-11-07T10:00:00Z");
    const persistence = new MemoryPersistence();
    const make = async () => {
      const s = new LocalStore({ persistence, broadcast: false, now: () => now });
      await s.ready;
      return s;
    };
    const store = await make();
    const gone = store.addTag("Gone", "c1");
    const kept = store.addTag("Kept", "c2");
    const a = store.addTask({ title: "A", tags: [gone.id, kept.id] });
    const b = store.addTask({ title: "B", tags: [gone.id] });
    store.deleteTag(gone.id);
    await store.flush();
    now = new Date("2026-12-08T10:00:00Z");
    store.addTask({ title: "A later record keeps the clock honest" });
    now = new Date("2026-12-08T10:05:00Z");
    expect(store.purgeDeleted()).toBeGreaterThanOrEqual(1);
    await store.flush();
    expect(store.getState().tags.some((t) => t.id === gone.id)).toBe(false);

    // No mass rewrite: both tasks still carry the id, and nothing about them is waiting to be sent.
    expect(store.getState().tasks.find((t) => t.id === a.id)!.tags).toContain(gone.id);
    expect(store.getState().tasks.find((t) => t.id === b.id)!.tags).toEqual([gone.id]);

    const again = await make(); // a reload: the purge is remembered
    again.updateTask(a.id, { title: "A, edited" });
    await again.flush();
    expect(again.getState().tasks.find((t) => t.id === a.id)!.tags).toEqual([kept.id]); // cleared with the edit
    expect(again.getState().outbox.find((o) => o.id === a.id)!.changedFields[`tag:${gone.id}`]).toBe(false);
    expect(again.getState().tasks.find((t) => t.id === b.id)!.tags).toEqual([gone.id]); // not edited, not touched
    expect(again.getState().outbox.some((o) => o.id === b.id && o.op === "update" && `tag:${gone.id}` in o.changedFields)).toBe(false);
  });
});
