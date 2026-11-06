import { newSeries, validate, type Series } from "./repeat";
import { MemoryPersistence, defaultPersistence, type PersistOp, type Persistence } from "./persistence";
import {
  RESTORE_DAYS,
  type CalendarEvent,
  type CalendarPatch,
  type EventPatch,
  type FeedEvent,
  type ListColour,
  type ListPatch,
  type NewEvent,
  type NewTask,
  type PlannerCalendar,
  type OutboxEntry,
  type OutboxOp,
  type PlannerState,
  type PlannerStore,
  type RecordType,
  type Task,
  type TaskList,
  type TaskPatch,
} from "./types";

export interface LocalStoreOptions {
  persistence?: Persistence;
  now?: () => Date;
  newId?: () => string;
}

interface Change {
  tasks?: Task[];
  removed?: string[];
  lists?: TaskList[];
  events?: CalendarEvent[];
  removedEvents?: string[];
  calendars?: PlannerCalendar[];
  entries: [RecordType, string, OutboxOp][];
}

export class LocalStore implements PlannerStore {
  readonly ready: Promise<void>;
  private state: PlannerState = { ready: false, tasks: [], lists: [], events: [], calendars: [], outbox: [] };
  private listeners = new Set<() => void>();
  private persistence: Persistence;
  private writes: Promise<void> = Promise.resolve();
  private readonly now: () => Date;
  private readonly newId: () => string;

  constructor(options: LocalStoreOptions = {}) {
    this.persistence = options.persistence ?? defaultPersistence();
    this.now = options.now ?? (() => new Date());
    this.newId = options.newId ?? (() => crypto.randomUUID());
    this.ready = this.load();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = (): PlannerState => this.state;

  /** Resolves once every write so far has reached the persistence layer. */
  flush(): Promise<void> {
    return this.writes;
  }

  pendingChanges(): number {
    return this.state.outbox.length;
  }

  private async load(): Promise<void> {
    let snapshot;
    try {
      snapshot = await this.persistence.load();
    } catch {
      // IndexedDB can be blocked or broken; carry on in memory for this visit.
      this.persistence = new MemoryPersistence();
      snapshot = await this.persistence.load();
    }
    this.state = {
      ready: true,
      tasks: snapshot.tasks,
      lists: snapshot.lists,
      events: snapshot.events,
      calendars: snapshot.calendars,
      outbox: snapshot.outbox,
    };
    if (!this.state.lists.some((l) => l.isInbox)) {
      const inbox = this.makeList("Inbox", "c1", true);
      this.commit({ lists: [inbox], entries: [["list", inbox.id, "create"]] });
    }
    if (!this.state.calendars.some((c) => c.kind.type === "local")) {
      const personal = this.makeCalendar("Personal", "c2", { type: "local" });
      this.commit({ calendars: [personal], entries: [["calendar", personal.id, "create"]] });
    }
    this.purgeDeleted();
    this.emit();
  }

  private makeList(name: string, colour: ListColour, isInbox: boolean): TaskList {
    return { id: this.newId(), name, colour, isInbox };
  }

  private makeCalendar(name: string, colour: ListColour, kind: PlannerCalendar["kind"]): PlannerCalendar {
    return { id: this.newId(), name, colour, visible: true, kind };
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  private assertReady(): void {
    if (!this.state.ready) throw new Error("The store is still loading");
  }

  /** Applies a change, records it in the outbox and writes it through. */
  private commit(change: Change): void {
    const at = this.now().toISOString();
    let seq = this.state.outbox.reduce((max, e) => Math.max(max, e.seq), 0);
    const ops: PersistOp[] = [];

    const tasks = new Map(this.state.tasks.map((t) => [t.id, t]));
    for (const t of change.tasks ?? []) {
      tasks.set(t.id, t);
      ops.push({ store: "tasks", put: t });
    }
    for (const id of change.removed ?? []) {
      tasks.delete(id);
      ops.push({ store: "tasks", delete: id });
    }

    const lists = [...this.state.lists];
    for (const list of change.lists ?? []) {
      const i = lists.findIndex((l) => l.id === list.id);
      if (i >= 0) lists[i] = list;
      else lists.push(list);
      ops.push({ store: "lists", put: list });
    }

    const events = new Map(this.state.events.map((e) => [e.id, e]));
    for (const e of change.events ?? []) {
      events.set(e.id, e);
      ops.push({ store: "events", put: e });
    }
    for (const id of change.removedEvents ?? []) {
      events.delete(id);
      ops.push({ store: "events", delete: id });
    }

    const calendars = [...this.state.calendars];
    for (const calendar of change.calendars ?? []) {
      const i = calendars.findIndex((c) => c.id === calendar.id);
      if (i >= 0) calendars[i] = calendar;
      else calendars.push(calendar);
      ops.push({ store: "calendars", put: calendar });
    }

    const outbox = [...this.state.outbox];
    for (const [type, id, op] of change.entries) {
      const entry: OutboxEntry = { seq: ++seq, type, id, op, at };
      outbox.push(entry);
      ops.push({ store: "outbox", put: entry });
    }

    this.state = { ...this.state, tasks: [...tasks.values()], lists, events: [...events.values()], calendars, outbox };
    this.writes = this.writes.then(() => this.persistence.write(ops)).catch(() => undefined);
    this.emit();
  }

  private task(id: string): Task {
    const found = this.state.tasks.find((t) => t.id === id);
    if (!found) throw new Error(`No task ${id}`);
    return found;
  }

  private change(id: string, op: OutboxOp, apply: (t: Task) => Partial<Task>): void {
    this.assertReady();
    const current = this.task(id);
    const updated: Task = { ...current, ...apply(current), updatedAt: this.now().toISOString() };
    this.commit({ tasks: [updated], entries: [["task", id, op]] });
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
      createdAt: stamp,
      updatedAt: stamp,
    };
    this.commit({ tasks: [task], entries: [["task", task.id, "create"]] });
    return task;
  }

  updateTask(id: string, patch: TaskPatch): void {
    this.change(id, "update", () => patch);
  }

  setDone(id: string, done: boolean): void {
    this.change(id, "update", () => ({ done, completedAt: done ? this.now().toISOString() : null }));
  }

  deleteTask(id: string): void {
    this.change(id, "delete", () => ({ deletedAt: this.now().toISOString() }));
  }

  restoreTask(id: string): void {
    this.change(id, "update", () => ({ deletedAt: null }));
  }

  purgeDeleted(): number {
    const cutoff = this.now().getTime() - RESTORE_DAYS * 86_400_000;
    const gone = (x: { deletedAt: string | null }) => x.deletedAt !== null && new Date(x.deletedAt).getTime() < cutoff;
    const oldTasks = this.state.tasks.filter(gone);
    const oldEvents = this.state.events.filter(gone);
    if (oldTasks.length + oldEvents.length === 0) return 0;
    this.commit({
      removed: oldTasks.map((t) => t.id),
      removedEvents: oldEvents.map((e) => e.id),
      entries: [
        ...oldTasks.map((t): ["task", string, "purge"] => ["task", t.id, "purge"]),
        ...oldEvents.map((e): ["event", string, "purge"] => ["event", e.id, "purge"]),
      ],
    });
    return oldTasks.length + oldEvents.length;
  }

  addList(name: string, colour: ListColour): TaskList {
    this.assertReady();
    const list = this.makeList(name.trim(), colour, false);
    this.commit({ lists: [list], entries: [["list", list.id, "create"]] });
    return list;
  }

  updateList(id: string, patch: ListPatch): void {
    this.assertReady();
    const current = this.state.lists.find((l) => l.id === id);
    if (!current) throw new Error(`No list ${id}`);
    const next: TaskList = { ...current, ...patch, name: (patch.name ?? current.name).trim() };
    this.commit({ lists: [next], entries: [["list", id, "update"]] });
  }

  private event(id: string): CalendarEvent {
    const found = this.state.events.find((e) => e.id === id);
    if (!found) throw new Error(`No event ${id}`);
    if (found.readOnly) throw new Error("This event belongs to a subscribed calendar");
    return found;
  }

  private changeEvent(id: string, op: OutboxOp, apply: (e: CalendarEvent) => Partial<CalendarEvent>): void {
    this.assertReady();
    const current = this.event(id);
    const updated: CalendarEvent = { ...current, ...apply(current), updatedAt: this.now().toISOString() };
    this.commit({ events: [updated], entries: [["event", id, op]] });
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
      readOnly: false,
      deletedAt: null,
      createdAt: stamp,
      updatedAt: stamp,
    };
    if (event.repeat) validate(event.repeat);
    this.commit({ events: [event], entries: [["event", event.id, "create"]] });
    return event;
  }

  updateEvent(id: string, patch: EventPatch): void {
    this.changeEvent(id, "update", (e) => {
      const next: Partial<CalendarEvent> = { ...patch };
      // Moving a repeating event moves its series; the rule stays.
      if (patch.start !== undefined && e.repeat && patch.repeat === undefined) {
        const series: Series = { ...e.repeat, start: patch.start.slice(0, 10), skipped: [] };
        validate(series);
        next.repeat = series;
      }
      if (next.repeat) validate(next.repeat);
      return next;
    });
  }

  deleteEvent(id: string): void {
    this.changeEvent(id, "delete", () => ({ deletedAt: this.now().toISOString() }));
  }

  restoreEvent(id: string): void {
    this.changeEvent(id, "update", () => ({ deletedAt: null }));
  }

  addCalendar(name: string, colour: ListColour): PlannerCalendar {
    this.assertReady();
    const calendar = this.makeCalendar(name.trim(), colour, { type: "local" });
    this.commit({ calendars: [calendar], entries: [["calendar", calendar.id, "create"]] });
    return calendar;
  }

  addSubscription(name: string, colour: ListColour, url: string): PlannerCalendar {
    this.assertReady();
    const calendar = this.makeCalendar(name.trim(), colour, { type: "subscribed", url, lastRefreshed: null, error: null });
    this.commit({ calendars: [calendar], entries: [["calendar", calendar.id, "create"]] });
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
    const next: PlannerCalendar = { ...current, ...patch, name: (patch.name ?? current.name).trim() };
    this.commit({ calendars: [next], entries: [["calendar", id, "update"]] });
  }

  replaceFeedEvents(calendarId: string, events: FeedEvent[]): void {
    this.assertReady();
    const calendar = this.calendar(calendarId);
    if (calendar.kind.type !== "subscribed") throw new Error("Not a subscribed calendar");
    const at = this.now().toISOString();
    const fresh: CalendarEvent[] = events.map((e) => ({
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
      readOnly: true,
      deletedAt: null,
      createdAt: at,
      updatedAt: at,
    }));
    const removed = this.state.events.filter((e) => e.calendarId === calendarId).map((e) => e.id);
    const next: PlannerCalendar = { ...calendar, kind: { ...calendar.kind, lastRefreshed: at, error: null } };
    // A feed read is not a person's edit, so nothing goes to the outbox.
    this.commit({ events: fresh, removedEvents: removed, calendars: [next], entries: [] });
  }

  failSubscription(calendarId: string, error: string): void {
    this.assertReady();
    const calendar = this.calendar(calendarId);
    if (calendar.kind.type !== "subscribed") throw new Error("Not a subscribed calendar");
    this.commit({ calendars: [{ ...calendar, kind: { ...calendar.kind, error } }], entries: [] });
  }
}
