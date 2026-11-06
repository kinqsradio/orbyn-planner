import { makeDue, parseDue } from "../lib/dates";
import type { Occurrence } from "./occurrences";
import { firstOccurrence, newSeries, skip, splitAt, type Repeat, type Series } from "./repeat";
import type { CalendarEvent, EventPatch, PlannerStore } from "./types";

/** Which events an edit or delete reaches: "This event", "This and following", "All events". */
export type Scope = "this" | "following" | "all";

/** What a person changed on one occurrence. `repeat` is the new rule (null to stop repeating). */
export type OccurrenceEdit = Omit<EventPatch, "repeat"> & { repeat?: Repeat | null };

const minutes = (value: string): number => parseDue(value).date.getTime() / 60_000;
/** "This and following" on the first occurrence is the same as "All events". */
const startsSeries = (e: CalendarEvent, date: string) => !e.repeat || firstOccurrence(e.repeat) === date;

/** The event's own first start and end after the occurrence on `occ.date` moved to `start`/`end`. */
function moveBase(event: CalendarEvent, occ: Occurrence, start: string, end: string): { start: string; end: string } {
  const delta = (minutes(start) - minutes(occ.start)) * 60_000;
  const length = (minutes(end) - minutes(start)) * 60_000;
  const first = new Date(parseDue(event.start).date.getTime() + delta);
  const hasTime = !event.allDay;
  return { start: makeDue(first, hasTime), end: makeDue(new Date(first.getTime() + length), hasTime) };
}

const withRule = (start: string, rule: Repeat | null | undefined, keep: Series | null): Series | null =>
  rule === undefined ? keep : rule === null ? null : newSeries(start.slice(0, 10), rule);

/**
 * Saves a change to one occurrence of an event. "This event" takes the date out of the series and
 * adds a one-off copy with the change; "This and following" splits the series there; "All events"
 * changes the whole series. Returns the new event when one was made.
 */
export function editOccurrence(store: PlannerStore, occ: Occurrence, scope: Scope, edit: OccurrenceEdit): CalendarEvent | null {
  const event = occ.event;
  const { repeat: rule, ...fields } = edit;
  const start = fields.start ?? occ.start;
  const end = fields.end ?? occ.end;

  if (!event.repeat) {
    store.updateEvent(event.id, { ...fields, repeat: withRule(start, rule, null) });
    return null;
  }

  if (scope === "all" || (scope === "following" && startsSeries(event, occ.date))) {
    const moved = moveBase(event, occ, start, end);
    const day = moved.start.slice(0, 10);
    const next: Series | null =
      rule === undefined
        ? { ...event.repeat, start: day, skipped: day === event.repeat.start ? event.repeat.skipped : [] }
        : rule === null
          ? null
          : newSeries(day, rule);
    store.updateEvent(event.id, { ...fields, ...moved, repeat: next });
    return null;
  }

  if (scope === "this") {
    store.updateEvent(event.id, { repeat: skip(event.repeat, occ.date) });
    return store.addEvent({ ...copyOf(event), ...fields, start, end, repeat: null, series: null });
  }

  // "following": end the series before this date and start a new one here.
  const [first, following] = splitAt(event.repeat, occ.date);
  store.updateEvent(event.id, { repeat: first });
  const series: Series | null =
    rule === undefined
      ? { ...following, start: start.slice(0, 10), skipped: start.slice(0, 10) === occ.date ? following.skipped : [] }
      : rule === null
        ? null
        : newSeries(start.slice(0, 10), rule);
  return store.addEvent({ ...copyOf(event), ...fields, start, end, repeat: null, series });
}

/** The parts of an event a copy keeps. */
function copyOf(event: CalendarEvent) {
  return {
    title: event.title,
    calendarId: event.calendarId,
    allDay: event.allDay,
    place: event.place,
    notes: event.notes,
    people: event.people.map((p) => ({ ...p })),
    reminder: event.reminder,
  };
}

/**
 * Deletes one occurrence, this and the following ones, or the whole event. Returns a function that
 * puts things back, for the Undo toast.
 */
export function deleteOccurrence(store: PlannerStore, occ: Occurrence, scope: Scope): () => void {
  const event = occ.event;
  const original = event.repeat;
  if (!original || scope === "all" || (scope === "following" && startsSeries(event, occ.date))) {
    store.deleteEvent(event.id);
    return () => store.restoreEvent(event.id);
  }
  if (scope === "this") {
    store.updateEvent(event.id, { repeat: skip(original, occ.date) });
  } else {
    const [first] = splitAt(original, occ.date);
    store.updateEvent(event.id, { repeat: first });
  }
  return () => store.updateEvent(event.id, { repeat: original });
}

/** A standalone copy of one occurrence. */
export function duplicateOccurrence(store: PlannerStore, occ: Occurrence): CalendarEvent {
  const event = occ.event;
  return store.addEvent({ ...copyOf(event), title: event.title, start: occ.start, end: occ.end, repeat: null, series: null });
}
