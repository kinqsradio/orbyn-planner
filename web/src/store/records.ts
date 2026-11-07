import { applyEventFields, toStored as eventToStored, toView as eventToView } from "./eventRecord";
import type { AnyRecord } from "./outbox";
import { SKIP_PREFIX } from "./eventRecord";
import { type Repeat, type Series } from "./repeat";
import type { CalendarEvent, Project, ProjectSection, RecordType, Task } from "./types";

/**
 * Records are kept and sent in the engine's shape, and used by the app in a handier one:
 * - a repeat is one field (`repeat: { start, repeat }`) and each skipped date a field of its own
 *   (`repeat.skip.<date>`), for tasks and events alike;
 * - a project's sections are fields of their own too (`section.<id>.name`, `.order` and `.removed`),
 *   like a task's checklist steps, so two devices that edit different sections keep both edits.
 * Writes are per field, so what two devices change at once merges instead of one replacing the other.
 */
type Fields = Record<string, unknown>;

export const SECTION_PREFIX = "section.";
/** A task carries a tag as the field `tag:<tagId>` (true; false once removed). */
export const TAG_PREFIX = "tag:";
/** A task carries at most this many tags; a record that claims more has the extra ones ignored. */
export const MAX_TAGS_PER_TASK = 100;
const TAG_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isTagId = (id: string) => TAG_ID.test(id);

/**
 * A task's fields with the tag fields that can't be trusted left out, never the task: a `tag:<id>` whose id isn't UUID-form,
 * or whose value isn't true or false, is ignored, and so are the tags beyond the first 100 (by id, the same on every device).
 * Fields from another device are checked with this on the way in (`sync/mapping.ts`) and again when a record is read.
 */
export function validTagFields(fields: Fields): Fields {
  const out: Fields = {};
  const added: string[] = [];
  for (const [k, v] of Object.entries(fields)) {
    if (!k.startsWith(TAG_PREFIX)) {
      out[k] = v;
      continue;
    }
    const id = k.slice(TAG_PREFIX.length);
    if (!isTagId(id) || typeof v !== "boolean") continue;
    if (v) added.push(id);
    else out[k] = v;
  }
  for (const id of added.sort().slice(0, MAX_TAGS_PER_TASK)) out[TAG_PREFIX + id] = true;
  return out;
}

// Tasks ------------------------------------------------------------------------------------------

function taskToView(raw: Fields): Task {
  const stored = validTagFields(raw);
  const skipped: string[] = [];
  const tags: string[] = [];
  const rest: Fields = {};
  for (const [k, v] of Object.entries(stored)) {
    if (k.startsWith(SKIP_PREFIX)) {
      if (v === true) skipped.push(k.slice(SKIP_PREFIX.length));
    } else if (k.startsWith(TAG_PREFIX)) {
      if (v === true) tags.push(k.slice(TAG_PREFIX.length));
    } else if (k !== "tags") rest[k] = v;
  }
  const rule = rest.repeat as { start: string; repeat: Repeat } | null | undefined;
  const task = { overrideOf: null, ...rest, tags: tags.sort(), repeat: rule ? { start: rule.start, repeat: rule.repeat, skipped: skipped.sort() } : null } as unknown as Task;
  return task;
}

function taskToStored(task: Task): Fields {
  const { repeat, tags, ...rest } = task;
  const out: Fields = { ...rest, repeat: repeat ? { start: repeat.start, repeat: repeat.repeat } : null };
  for (const d of repeat?.skipped ?? []) out[SKIP_PREFIX + d] = true;
  for (const id of tags ?? []) out[TAG_PREFIX + id] = true;
  return out;
}

function applyTaskFields(task: Task, raw: Fields): Task {
  const fields = validTagFields(raw);
  let next: Task = { ...task };
  if ("repeat" in fields) {
    const rule = fields.repeat as { start: string; repeat: Repeat } | null;
    next.repeat = rule ? { start: rule.start, repeat: rule.repeat, skipped: next.repeat?.skipped ?? [] } : null;
  }
  for (const [k, v] of Object.entries(fields)) {
    if (k === "repeat") continue;
    if (k.startsWith(TAG_PREFIX)) {
      const id = k.slice(TAG_PREFIX.length);
      const rest = next.tags.filter((t) => t !== id);
      // The merged set, then the first 100 by id: exactly what reading the stored record gives, so a reload never changes which show.
      next = { ...next, tags: (v === true ? [...rest, id] : rest).sort().slice(0, MAX_TAGS_PER_TASK) };
    } else if (k.startsWith(SKIP_PREFIX)) {
      if (!next.repeat) continue;
      const date = k.slice(SKIP_PREFIX.length);
      const rest = next.repeat.skipped.filter((d) => d !== date);
      next = { ...next, repeat: { ...next.repeat, skipped: v === true ? [...rest, date].sort() : rest } as Series };
    } else {
      (next as unknown as Fields)[k] = v;
    }
  }
  return next;
}

// Projects ---------------------------------------------------------------------------------------

function projectToView(stored: Fields): Project {
  const parts = new Map<string, { name?: string; order?: string; removed?: boolean }>();
  const rest: Fields = {};
  for (const [k, v] of Object.entries(stored)) {
    const m = k.startsWith(SECTION_PREFIX) ? /^section\.(.+)\.(name|order|removed)$/.exec(k) : null;
    if (!m) {
      if (k !== "sections") rest[k] = v;
      continue;
    }
    const entry = parts.get(m[1]!) ?? {};
    (entry as Fields)[m[2]!] = v;
    parts.set(m[1]!, entry);
  }
  // A project saved before sections were fields has a `sections` array; its sections count unless a field says otherwise.
  const legacy = stored.sections;
  if (Array.isArray(legacy)) {
    for (const x of legacy as Partial<ProjectSection>[]) {
      if (typeof x?.id !== "string") continue;
      const e = parts.get(x.id) ?? {};
      if (e.name === undefined) e.name = x.name;
      if (e.order === undefined) e.order = x.order;
      parts.set(x.id, e);
    }
  }
  const sections: ProjectSection[] = [];
  for (const [id, e] of parts) {
    if (e.removed === true || typeof e.name !== "string" || typeof e.order !== "string") continue;
    sections.push({ id, name: e.name, order: e.order });
  }
  return { ...(rest as unknown as Project), sections };
}

function projectToStored(project: Project): Fields {
  const { sections, ...rest } = project;
  const out: Fields = { ...rest };
  for (const s of sections) {
    out[`${SECTION_PREFIX}${s.id}.name`] = s.name;
    out[`${SECTION_PREFIX}${s.id}.order`] = s.order;
  }
  return out;
}

function applyProjectFields(project: Project, fields: Fields): Project {
  const view = projectToStored(project);
  return projectToView({ ...view, ...fields });
}

/** The fields that add, rename, move or remove sections, for a patch. */
export const sectionFields = {
  add: (s: ProjectSection): Fields => ({ [`${SECTION_PREFIX}${s.id}.name`]: s.name, [`${SECTION_PREFIX}${s.id}.order`]: s.order, [`${SECTION_PREFIX}${s.id}.removed`]: false }),
  rename: (id: string, name: string): Fields => ({ [`${SECTION_PREFIX}${id}.name`]: name }),
  move: (id: string, order: string): Fields => ({ [`${SECTION_PREFIX}${id}.order`]: order }),
  remove: (id: string): Fields => ({ [`${SECTION_PREFIX}${id}.removed`]: true }),
};

// The three together -----------------------------------------------------------------------------

/** A record as read from storage, in the shape the app uses. */
export function viewOf(type: RecordType, stored: AnyRecord): AnyRecord {
  const f = stored as unknown as Fields;
  if (type === "event") return eventToView(f);
  if (type === "task") return taskToView(f) as AnyRecord;
  if (type === "project") return projectToView(f);
  return stored;
}

/** A new record as it is stored and sent. */
export function storedOf(type: RecordType, view: AnyRecord): AnyRecord {
  if (type === "event") return eventToStored(view as CalendarEvent) as unknown as AnyRecord;
  if (type === "task") return taskToStored(view as Task) as unknown as AnyRecord;
  if (type === "project") return projectToStored(view as Project) as unknown as AnyRecord;
  return view;
}

/** A patch (in the stored shape) applied to a record the app holds, as storage will apply it. */
export function applyFields(type: RecordType, view: AnyRecord, fields: Fields): AnyRecord {
  if (type === "event") return applyEventFields(view as CalendarEvent, fields);
  if (type === "task") return applyTaskFields(view as Task, fields);
  if (type === "project") return applyProjectFields(view as Project, fields);
  return { ...view, ...fields } as AnyRecord;
}
