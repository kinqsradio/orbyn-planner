import { repeatFields } from "./eventRecord";
import { applyFields, sectionFields, storedOf, viewOf } from "./records";
import { coalesce, refKey, type AnyRecord, type Patch, type Ref } from "./outbox";
import { defaultPersistence, type Acknowledged, type ApplyResult, type Persistence } from "./persistence";
import { inOrder, keyBetween } from "./order";
import { newSeries, validate } from "./repeat";
import { completeRepeating } from "./taskRepeat";
import {
  RESTORE_DAYS,
  type CalendarEvent,
  type CalendarPatch,
  type EventPatch,
  type FeedEvent,
  type ListColour,
  type ListPatch,
  type NewEvent,
  type NewProject,
  type NewTask,
  type PlannerCalendar,
  type Project,
  type ProjectPatch,
  type ProjectSection,
  type OutboxEntry,
  type PersistenceState,
  type PlannerState,
  type PlannerStore,
  type RecordType,
  type RemoteChange,
  type Task,
  type TaskList,
  type TaskPatch,
} from "./types";

/** Every tab makes the Inbox with this id, so two tabs starting together still end with one. */
export const INBOX_ID = "inbox";
/** Likewise the first calendar. */
export const PERSONAL_CALENDAR_ID = "personal";
export const CHANNEL_NAME = "orbyn-planner";
const DAY_MS = 86_400_000;
/** Stamps newer than this were made with the clock the purge is checking, so they prove nothing about it. */
const CLOCK_CHECK_MS = 60_000;
const KEY_OF = { task: "tasks", list: "lists", event: "events", calendar: "calendars", project: "projects" } as const;

export interface LocalStoreOptions {
  persistence?: Persistence;
  now?: () => Date;
  newId?: () => string;
  /** Called when another tab upgrades the database and this one must start over. Defaults to a page reload. */
  onReload?: () => void;
  /** Tell other tabs about writes. Defaults to on where BroadcastChannel exists. */
  broadcast?: boolean;
}

type PatchInput = Patch extends infer P ? (P extends Patch ? Omit<P, "key"> : never) : never;

function describe(error: unknown, doing: "write" | "open"): string {
  const name = error instanceof DOMException || error instanceof Error ? error.name : "";
  if (name === "QuotaExceededError") return "This device is out of storage.";
  return doing === "open" ? "Couldn’t open this device’s storage." : "Couldn’t write to this device’s storage.";
}

export class LocalStore implements PlannerStore {
  readonly ready: Promise<void>;
  private state: PlannerState = { ready: false, tasks: [], lists: [], events: [], calendars: [], projects: [], outbox: [], persistence: { status: "ok" } };
  private listeners = new Set<() => void>();
  private persistence: Persistence;
  private writes: Promise<void> = Promise.resolve();
  /** False when storage could not be opened: changes then stay on screen, marked as not saved. */
  private writable = true;
  private provisional = 0;
  private pending = new Map<string, number>();
  private channel: BroadcastChannel | null = null;
  private readonly tab = Math.random().toString(36).slice(2);
  private readonly now: () => Date;
  private readonly newId: () => string;

  constructor(options: LocalStoreOptions = {}) {
    this.persistence = options.persistence ?? defaultPersistence();
    this.now = options.now ?? (() => new Date());
    this.newId = options.newId ?? (() => crypto.randomUUID());
    this.state = { ...this.state, persistence: this.persistence.durable ? { status: "ok" } : { status: "memory" } };

    const reload = options.onReload ?? (() => window.location.reload());
    this.persistence.setHandlers({
      onVersionChange: () => {
        this.setPersistence({ status: "failed", reason: "Another tab updated Orbyn Planner. This page will reload." });
        reload();
      },
      onBlocked: () => this.setPersistence({ status: "failed", reason: "Close the other Orbyn Planner tabs to finish updating." }),
    });
    if ((options.broadcast ?? true) && typeof BroadcastChannel !== "undefined") {
      this.channel = new BroadcastChannel(CHANNEL_NAME);
      this.channel.onmessage = (event: MessageEvent<{ tab: string; refs: Ref[] }>) => {
        if (event.data.tab !== this.tab) void this.refresh(event.data.refs);
      };
    }
    this.ready = this.load();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = (): PlannerState => this.state;

  /** Resolves once every write so far has been tried. */
  flush(): Promise<void> {
    return this.writes;
  }

  /** Stops listening to other tabs. */
  close(): void {
    this.channel?.close();
    this.channel = null;
  }

  nowIso(): string {
    return this.now().toISOString();
  }

  async acknowledge(sent: Acknowledged[]): Promise<void> {
    if (sent.length === 0) return;
    await this.flush(); // writes made so far are in storage, so the comparison below sees them
    const result = await this.persistence.acknowledge(sent);
    this.reconcile(result);
    this.channel?.postMessage({ tab: this.tab, refs: sent.map((s) => ({ type: s.type, id: s.id })) });
  }

  async applyRemote(changes: RemoteChange[]): Promise<void> {
    this.assertReady();
    const inputs: PatchInput[] = [];
    for (const c of changes) {
      const here = this.current(c.type, c.id);
      if (c.fields === null) {
        if (here) inputs.push({ type: c.type, id: c.id, op: "purge", local: true });
      } else if (here) {
        inputs.push({ type: c.type, id: c.id, op: "update", fields: c.fields, local: true });
      } else {
        inputs.push({ type: c.type, id: c.id, op: "create", record: viewOf(c.type, { id: c.id, ...c.fields } as unknown as AnyRecord), local: true });
      }
    }
    if (inputs.length > 0) this.commit(inputs);
    await this.flush();
  }

  pendingChanges(): number {
    return this.state.outbox.length;
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  private setPersistence(next: PersistenceState): void {
    this.state = { ...this.state, persistence: next };
    this.emit();
  }

  private assertReady(): void {
    if (!this.state.ready) throw new Error("The store is still loading");
  }

  private async load(): Promise<void> {
    let snapshot = { tasks: [] as Task[], lists: [] as TaskList[], events: [] as CalendarEvent[], calendars: [] as PlannerCalendar[], projects: [] as Project[], outbox: [] as OutboxEntry[] };
    let persistence = this.state.persistence;
    try {
      snapshot = await this.persistence.load();
      if (persistence.status === "failed") persistence = this.persistence.durable ? { status: "ok" } : { status: "memory" };
    } catch (error) {
      // Not a quiet fall-back to memory: the person is told, and nothing is written over what is there.
      this.writable = false;
      persistence = { status: "failed", reason: describe(error, "open") };
    }
    this.state = { ready: true, ...snapshot, events: snapshot.events.map((e) => viewOf("event", e as unknown as AnyRecord) as unknown as CalendarEvent), tasks: snapshot.tasks.map((t) => viewOf("task", t as unknown as AnyRecord) as unknown as Task), projects: snapshot.projects.map((x) => viewOf("project", x as unknown as AnyRecord) as unknown as Project), persistence };
    if (!this.state.lists.some((l) => l.isInbox)) {
      const inbox: TaskList = { id: INBOX_ID, name: "Inbox", colour: "c1", isInbox: true };
      this.commit([{ type: "list", id: inbox.id, op: "create", record: inbox }]);
    }
    if (!this.state.calendars.some((c) => c.kind.type === "local")) {
      const personal: PlannerCalendar = { id: PERSONAL_CALENDAR_ID, name: "Personal", colour: "c2", visible: true, kind: { type: "local" } };
      this.commit([{ type: "calendar", id: personal.id, op: "create", record: personal }]);
    }
    this.purgeDeleted();
    this.emit();
  }

  // Records in memory ---------------------------------------------------------------------------

  private replaceRecord(type: RecordType, id: string, record: AnyRecord | null): void {
    const key = KEY_OF[type];
    const list = [...(this.state[key] as readonly AnyRecord[])];
    const index = list.findIndex((r) => r.id === id);
    if (record === null) {
      if (index >= 0) list.splice(index, 1);
    } else if (index >= 0) {
      list[index] = record; // a changed record keeps its place
    } else {
      list.push(record);
    }
    this.state = { ...this.state, [key]: list };
  }

  private current(type: RecordType, id: string): AnyRecord | undefined {
    return (this.state[KEY_OF[type]] as readonly AnyRecord[]).find((r) => r.id === id);
  }

  private setOutbox(type: RecordType, id: string, entry: OutboxEntry | null): void {
    const rest = this.state.outbox.filter((e) => !(e.type === type && e.id === id));
    this.state = { ...this.state, outbox: entry ? [...rest, entry] : rest };
  }

  /** Applies patches to what is on screen, as the write will apply them in storage. */
  private applyLocal(patches: Patch[], wire: Patch[], at: string): void {
    for (const [i, p] of patches.entries()) {
      if (p.op === "create") {
        if (this.current(p.type, p.id)) continue;
        this.replaceRecord(p.type, p.id, p.record);
      } else if (p.op === "purge") {
        this.replaceRecord(p.type, p.id, null);
      } else {
        const record = this.current(p.type, p.id);
        if (!record) continue;
        this.replaceRecord(
          p.type,
          p.id,
          applyFields(p.type, record, p.fields),
        );
      }
      if (p.local) continue;
      const existing = this.state.outbox.find((e) => e.type === p.type && e.id === p.id);
      const change = coalesce(existing, wire[i]!, at);
      if (change.write) {
        this.setOutbox(p.type, p.id, { ...change.write, seq: change.write.seq || -++this.provisional });
      } else if (change.remove !== undefined) {
        this.setOutbox(p.type, p.id, null);
      }
    }
  }

  /** Takes storage's version of records, except ones with a write still on its way. */
  private reconcile(result: ApplyResult): void {
    for (const r of result.records) {
      if (this.pending.get(refKey(r))) continue;
      this.replaceRecord(r.type, r.id, r.record ? viewOf(r.type, r.record) : r.record);
    }
    for (const o of result.outbox) {
      if (this.pending.get(refKey(o))) continue;
      this.setOutbox(o.type, o.id, o.entry);
    }
    this.emit();
  }

  private async refresh(refs: Ref[]): Promise<void> {
    try {
      this.reconcile(await this.persistence.read(refs));
    } catch {
      // The next write or reload will say if storage is broken.
    }
  }

  /** Makes a change: on screen now, in storage and the outbox next, and tells other tabs. */
  private commit(inputs: PatchInput[]): void {
    const at = this.now().toISOString();
    const patches = inputs.map((p) => ({ ...p, key: this.newId() }) as Patch);
    // What is stored and sent is the engine's shape; the app holds events with their skips gathered.
    const wire = patches.map((p) => (p.op === "create" ? { ...p, record: storedOf(p.type, p.record) } : p));
    this.applyLocal(patches, wire, at);
    this.emit();
    if (!this.writable) return;
    for (const p of patches) this.pending.set(refKey(p), (this.pending.get(refKey(p)) ?? 0) + 1);
    this.writes = this.writes.then(async () => {
      try {
        const result = await this.persistence.apply({ at, patches: wire });
        for (const p of patches) this.pending.set(refKey(p), (this.pending.get(refKey(p)) ?? 1) - 1);
        this.reconcile(result);
        this.channel?.postMessage({ tab: this.tab, refs: patches.map((p) => ({ type: p.type, id: p.id })) });
      } catch (error) {
        for (const p of patches) this.pending.set(refKey(p), (this.pending.get(refKey(p)) ?? 1) - 1);
        // Stays failed until the page is reloaded: the changes on screen did not reach storage.
        this.setPersistence({ status: "failed", reason: describe(error, "write") });
      }
    });
  }

  // Tasks ---------------------------------------------------------------------------------------

  private task(id: string): Task {
    const found = this.state.tasks.find((t) => t.id === id);
    if (!found) throw new Error(`No task ${id}`);
    return found;
  }

  private change(id: string, op: "update" | "delete", fields: Record<string, unknown>): void {
    this.assertReady();
    this.task(id);
    this.commit([{ type: "task", id, op, fields: { ...fields, updatedAt: this.now().toISOString() } }]);
  }

  addTask(input: NewTask): Task {
    this.assertReady();
    const inbox = this.state.lists.find((l) => l.isInbox);
    const stamp = this.now().toISOString();
    const task: Task = {
      id: this.newId(),
      title: input.title.trim(),
      notes: input.notes ?? "",
      listId: input.listId ?? inbox!.id,
      due: input.due ?? null,
      priority: input.priority ?? "none",
      done: false,
      completedAt: null,
      deletedAt: null,
      checklist: input.checklist ?? [],
      projectId: input.projectId ?? null,
      sectionId: input.sectionId ?? null,
      repeat: input.repeat ? newSeries((input.due ?? stamp).slice(0, 10), input.repeat) : null,
      reminder: input.reminder ?? null,
      overrideOf: input.overrideOf ?? null,
      completions: [],
      createdAt: stamp,
      updatedAt: stamp,
    };
    this.commit([{ type: "task", id: task.id, op: "create", record: task }]);
    return task;
  }

  updateTask(id: string, patch: TaskPatch): void {
    const { repeat, ...rest } = patch;
    const fields: Record<string, unknown> = { ...rest };
    if (repeat !== undefined) {
      if (repeat) validate(repeat);
      Object.assign(fields, repeatFields(this.task(id).repeat, repeat));
    }
    this.change(id, "update", fields);
  }

  setDone(id: string, done: boolean): void {
    const task = this.task(id);
    // Completing a repeating task moves it to its next date instead of finishing it.
    if (done && task.repeat) this.change(id, "update", completeRepeating(task, this.now().toISOString()));
    else this.change(id, "update", { done, completedAt: done ? this.now().toISOString() : null });
  }

  deleteTask(id: string): void {
    const stamp = this.now().toISOString();
    // One-off copies of single dates outlive their series: they keep their title and stand alone.
    const copies = this.state.tasks.filter((t) => t.overrideOf?.id === id && t.deletedAt === null);
    this.assertReady();
    this.task(id);
    this.commit([
      { type: "task", id, op: "delete", fields: { deletedAt: stamp, updatedAt: stamp } },
      ...copies.map((c): PatchInput => ({ type: "task", id: c.id, op: "update", fields: { overrideOf: null, updatedAt: stamp } })),
    ]);
  }

  restoreTask(id: string): void {
    const task = this.task(id);
    // A section deleted in the meantime no longer exists: the task comes back to the project's top.
    const project = task.projectId ? this.state.projects.find((p) => p.id === task.projectId) : undefined;
    const lost = task.sectionId !== null && !project?.sections.some((s) => s.id === task.sectionId);
    this.change(id, "update", { deletedAt: null, ...(lost ? { sectionId: null } : {}) });
  }

  /**
   * Removes records deleted more than 30 days ago for good (a record never sent leaves no trace;
   * one that was sent leaves a delete entry in the outbox).
   *
   * It does nothing when this device's clock is more than a day past the newest timestamp it can
   * trust. A timestamp can be trusted only if this device did not just make it with the clock being
   * checked, so anything stamped within the last minute is ignored: otherwise a clock jumped far
   * ahead would stamp a fresh record, look up to date and wipe the whole Deleted list. Until sync
   * exists the evidence is the device's own older stamps; once it does, the newest server time
   * replaces them. After a long idle spell the purge waits for the next session after a change.
   */
  purgeDeleted(): number {
    const stamps = [
      ...this.state.tasks.flatMap((t) => [t.createdAt, t.updatedAt, t.completedAt, t.deletedAt]),
      ...this.state.events.flatMap((e) => [e.createdAt, e.updatedAt, e.deletedAt]),
      ...this.state.outbox.flatMap((e) => [e.createdAt, e.updatedAt]),
    ]
      .filter((s): s is string => s !== null)
      .map((s) => new Date(s).getTime())
      .filter((t) => t <= this.now().getTime() - CLOCK_CHECK_MS);
    const newest = stamps.length ? Math.max(...stamps) : 0;
    if (this.now().getTime() - newest > DAY_MS) return 0;
    const cutoff = this.now().getTime() - RESTORE_DAYS * DAY_MS;
    const gone = (x: { deletedAt: string | null }) => x.deletedAt !== null && new Date(x.deletedAt).getTime() < cutoff;
    const patches: PatchInput[] = [
      ...this.state.tasks.filter(gone).map((t): PatchInput => ({ type: "task", id: t.id, op: "purge" })),
      ...this.state.events.filter(gone).map((e): PatchInput => ({ type: "event", id: e.id, op: "purge" })),
    ];
    if (patches.length === 0) return 0;
    this.commit(patches);
    return patches.length;
  }

  // Lists ---------------------------------------------------------------------------------------

  addList(name: string, colour: ListColour): TaskList {
    this.assertReady();
    const list: TaskList = { id: this.newId(), name: name.trim(), colour, isInbox: false };
    this.commit([{ type: "list", id: list.id, op: "create", record: list }]);
    return list;
  }

  updateList(id: string, patch: ListPatch): void {
    this.assertReady();
    const current = this.state.lists.find((l) => l.id === id);
    if (!current) throw new Error(`No list ${id}`);
    const fields: Record<string, unknown> = { ...patch };
    if (patch.name !== undefined) fields.name = patch.name.trim() || current.name;
    this.commit([{ type: "list", id, op: "update", fields }]);
  }

  // Projects ------------------------------------------------------------------------------------

  private project(id: string): Project {
    const found = this.state.projects.find((p) => p.id === id);
    if (!found) throw new Error(`No project ${id}`);
    return found;
  }

  addProject(input: NewProject): Project {
    this.assertReady();
    const project: Project = { id: this.newId(), name: input.name.trim(), colour: input.colour, goal: input.goal ?? null, sections: [], archived: false };
    this.commit([{ type: "project", id: project.id, op: "create", record: project }]);
    return project;
  }

  updateProject(id: string, patch: ProjectPatch): void {
    this.assertReady();
    const current = this.project(id);
    const fields: Record<string, unknown> = { ...patch };
    if (patch.name !== undefined) fields.name = patch.name.trim() || current.name;
    this.commit([{ type: "project", id, op: "update", fields }]);
  }

  addSection(projectId: string, name: string): ProjectSection {
    this.assertReady();
    const project = this.project(projectId);
    const last = inOrder(project.sections).at(-1)?.order ?? null;
    const order = keyBetween(last, null);
    if (order === null) throw new Error("Too many sections");
    const section: ProjectSection = { id: this.newId(), name: name.trim(), order };
    this.commit([{ type: "project", id: projectId, op: "update", fields: sectionFields.add(section) }]);
    return section;
  }

  renameSection(projectId: string, sectionId: string, name: string): void {
    this.assertReady();
    const section = this.project(projectId).sections.find((s) => s.id === sectionId);
    if (!section) return;
    this.commit([{ type: "project", id: projectId, op: "update", fields: sectionFields.rename(sectionId, name.trim() || section.name) }]);
  }

  moveSection(projectId: string, sectionId: string, direction: "up" | "down"): void {
    this.assertReady();
    const project = this.project(projectId);
    const sorted = inOrder(project.sections);
    const i = sorted.findIndex((s) => s.id === sectionId);
    const j = direction === "up" ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= sorted.length) return;
    // Take the section out and put its key between its new neighbours; no other section changes.
    const rest = sorted.filter((s) => s.id !== sectionId);
    const order = keyBetween(rest[j - 1]?.order ?? null, rest[j]?.order ?? null);
    if (order === null) return;
    this.commit([{ type: "project", id: projectId, op: "update", fields: sectionFields.move(sectionId, order) }]);
  }

  deleteSection(projectId: string, sectionId: string): void {
    this.assertReady();
    this.project(projectId);
    const moved = this.state.tasks.filter((t) => t.sectionId === sectionId && t.deletedAt === null);
    const stamp = this.now().toISOString();
    this.commit([
      { type: "project", id: projectId, op: "update", fields: sectionFields.remove(sectionId) },
      ...moved.map((t): PatchInput => ({ type: "task", id: t.id, op: "update", fields: { sectionId: null, updatedAt: stamp } })),
    ]);
  }

  // Events and calendars ------------------------------------------------------------------------

  private event(id: string): CalendarEvent {
    const found = this.state.events.find((e) => e.id === id);
    if (!found) throw new Error(`No event ${id}`);
    if (found.readOnly) throw new Error("This event belongs to a subscribed calendar");
    return found;
  }

  private changeEvent(id: string, op: "update" | "delete", fields: Record<string, unknown>): void {
    this.assertReady();
    this.event(id);
    this.commit([{ type: "event", id, op, fields: { ...fields, updatedAt: this.now().toISOString() } }]);
  }

  addEvent(input: NewEvent): CalendarEvent {
    this.assertReady();
    const calendar = this.state.calendars.find((c) => c.id === input.calendarId) ?? this.state.calendars.find((c) => c.kind.type === "local");
    const stamp = this.now().toISOString();
    const event: CalendarEvent = {
      id: this.newId(),
      title: input.title.trim(),
      calendarId: calendar!.id,
      allDay: input.allDay ?? false,
      start: input.start,
      end: input.end,
      place: input.place ?? "",
      notes: input.notes ?? "",
      people: input.people ?? [],
      reminder: input.reminder ?? null,
      repeat: input.series ?? (input.repeat ? newSeries(input.start.slice(0, 10), input.repeat) : null),
      overrideOf: input.overrideOf ?? null,
      zone: input.zone ?? null,
      readOnly: false,
      deletedAt: null,
      createdAt: stamp,
      updatedAt: stamp,
    };
    if (event.repeat) validate(event.repeat);
    this.commit([{ type: "event", id: event.id, op: "create", record: event }]);
    return event;
  }

  updateEvent(id: string, patch: EventPatch): void {
    const current = this.event(id);
    const { repeat, ...rest } = patch;
    const fields: Record<string, unknown> = { ...rest };
    let next = repeat;
    // Moving a repeating event moves its series; the rule and the skipped dates stay.
    if (patch.start !== undefined && current.repeat && next === undefined) next = { ...current.repeat, start: patch.start.slice(0, 10) };
    if (next !== undefined) {
      if (next) validate(next);
      Object.assign(fields, repeatFields(current.repeat, next));
    }
    this.changeEvent(id, "update", fields);
  }

  deleteEvent(id: string): void {
    this.changeEvent(id, "delete", { deletedAt: this.now().toISOString() });
  }

  restoreEvent(id: string): void {
    this.changeEvent(id, "update", { deletedAt: null });
  }

  addCalendar(name: string, colour: ListColour): PlannerCalendar {
    this.assertReady();
    const calendar: PlannerCalendar = { id: this.newId(), name: name.trim(), colour, visible: true, kind: { type: "local" } };
    this.commit([{ type: "calendar", id: calendar.id, op: "create", record: calendar }]);
    return calendar;
  }

  addSubscription(name: string, colour: ListColour, url: string): PlannerCalendar {
    this.assertReady();
    const calendar: PlannerCalendar = {
      id: this.newId(),
      name: name.trim(),
      colour,
      visible: true,
      kind: { type: "subscribed", url, lastRefreshed: null, error: null },
    };
    this.commit([{ type: "calendar", id: calendar.id, op: "create", record: calendar }]);
    return calendar;
  }

  private calendar(id: string): PlannerCalendar {
    const found = this.state.calendars.find((c) => c.id === id);
    if (!found) throw new Error(`No calendar ${id}`);
    return found;
  }

  updateCalendar(id: string, patch: CalendarPatch): void {
    this.assertReady();
    const current = this.calendar(id);
    const fields: Record<string, unknown> = { ...patch };
    if (patch.name !== undefined) fields.name = patch.name.trim() || current.name;
    this.commit([{ type: "calendar", id, op: "update", fields }]);
  }

  replaceFeedEvents(calendarId: string, events: FeedEvent[]): void {
    this.assertReady();
    const calendar = this.calendar(calendarId);
    if (calendar.kind.type !== "subscribed") throw new Error("Not a subscribed calendar");
    const at = this.now().toISOString();
    const fresh = events.map((e): CalendarEvent => ({
      id: this.newId(),
      title: e.title,
      calendarId,
      allDay: e.allDay ?? false,
      start: e.start,
      end: e.end,
      place: e.place ?? "",
      notes: e.notes ?? "",
      people: [],
      reminder: null,
      repeat: e.series ?? null,
      overrideOf: null,
      zone: e.zone ?? null,
      readOnly: true,
      deletedAt: null,
      createdAt: at,
      updatedAt: at,
    }));
    // Reading a feed is not a person's edit: these patches are `local`, so nothing goes to the outbox.
    this.commit([
      ...this.state.events.filter((e) => e.calendarId === calendarId).map((e): PatchInput => ({ type: "event", id: e.id, op: "purge", local: true })),
      ...fresh.map((e): PatchInput => ({ type: "event", id: e.id, op: "create", record: e, local: true })),
      { type: "calendar", id: calendarId, op: "update", fields: { kind: { ...calendar.kind, lastRefreshed: at, error: null } }, local: true },
    ]);
  }

  failSubscription(calendarId: string, error: string): void {
    this.assertReady();
    const calendar = this.calendar(calendarId);
    if (calendar.kind.type !== "subscribed") throw new Error("Not a subscribed calendar");
    this.commit([{ type: "calendar", id: calendarId, op: "update", fields: { kind: { ...calendar.kind, error } }, local: true }]);
  }
}
