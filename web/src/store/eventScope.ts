import { addWall, daysBetween, wallMinutes } from "../lib/wall";
import type { Occurrence } from "./occurrences";
import { DAYS, firstOccurrence, newSeries, skip, splitAt, type Day, type Repeat, type Series } from "./repeat";
import type { CalendarEvent, EventPatch, PlannerStore } from "./types";

/** Which events an edit or delete reaches: "This event", "This and following", "All events". */
export type Scope = "this" | "following" | "all";

/** What a person changed on one occurrence. `repeat` is the new rule (null to stop repeating). */
export type OccurrenceEdit = Omit<EventPatch, "repeat"> & { repeat?: Repeat | null };

/** "This and following" on the first occurrence is the same as "All events". */
const startsSeries = (e: CalendarEvent, date: string) => !e.repeat || firstOccurrence(e.repeat) === date;

const sameRule = (a: Repeat, b: Repeat) => JSON.stringify(a) === JSON.stringify(b);

/** Moves weekdays by whole days: Monday moved one day on is Tuesday. */
export function shiftWeekdays(days: readonly Day[], by: number): Day[] {
  return days.map((d) => DAYS[(((DAYS.indexOf(d) + by) % 7) + 7) % 7]!);
}

const shiftDate = (date: string, by: number) => addWall(date, by);

/**
 * The event's own first start and end after the occurrence on `occ` moved to `start` and `end`. It
 * moves by whole calendar days and by the change in the time of day, so a daylight-saving change
 * cannot shift it by an hour.
 */
function moveBase(event: CalendarEvent, occ: Occurrence, start: string, end: string): { start: string; end: string } {
  const days = daysBetween(occ.start, start);
  const minutes = event.allDay ? 0 : wallMinutes(start) - wallMinutes(start.slice(0, 10)) - (wallMinutes(occ.start) - wallMinutes(occ.start.slice(0, 10)));
  const first = addWall(event.start, days, minutes);
  const last = event.allDay ? addWall(first, daysBetween(start, end)) : addWall(first, 0, wallMinutes(end) - wallMinutes(start));
  return { start: first, end: last };
}

/** The events that replace one date of this event ("This event" edits). */
const overridesOf = (store: PlannerStore, event: CalendarEvent) =>
  store.getState().events.filter((e) => e.overrideOf?.id === event.id && e.deletedAt === null);

/**
 * Saves a change to one occurrence of an event. "This event" takes the date out of the series and
 * adds a one-off copy with the change, linked to the date it replaces; "This and following" splits
 * the series there; "All events" changes the whole series. Dates taken out of the series, and the
 * one-off copies, stay as they were. Moving the occurrence to another weekday moves the series'
 * weekdays with it. Returns the new event when one was made.
 */
export function editOccurrence(store: PlannerStore, occ: Occurrence, scope: Scope, edit: OccurrenceEdit): CalendarEvent | null {
  const event = occ.event;
  const { repeat: asked, ...fields } = edit;
  const start = fields.start ?? occ.start;
  const end = fields.end ?? occ.end;
  const series = event.repeat;
  // A rule that is the one it already has is not a change, and must not reset anything.
  const rule = asked !== undefined && asked !== null && series && sameRule(series.repeat, asked) ? undefined : asked;

  if (!series) {
    store.updateEvent(event.id, { ...fields, repeat: rule === undefined || rule === null ? null : newSeries(start.slice(0, 10), rule) });
    return null;
  }

  if (scope === "all" || (scope === "following" && startsSeries(event, occ.date))) {
    const moved = moveBase(event, occ, start, end);
    const day = moved.start.slice(0, 10);
    const by = daysBetween(series.start, day);
    let next: Series | null;
    if (rule === null) next = null;
    else if (rule) next = { ...newSeries(day, rule), skipped: series.skipped.map((d) => shiftDate(d, by)) };
    else {
      next = {
        start: day,
        repeat: { ...series.repeat, weekdays: shiftWeekdays(series.repeat.weekdays, by) },
        skipped: series.skipped.map((d) => shiftDate(d, by)),
      };
    }
    store.updateEvent(event.id, { ...fields, ...moved, repeat: next });
    if (by !== 0) for (const o of overridesOf(store, event)) store.updateEvent(o.id, { overrideOf: { id: event.id, date: shiftDate(o.overrideOf!.date, by) } });
    return null;
  }

  if (scope === "this") {
    store.updateEvent(event.id, { repeat: skip(series, occ.date) });
    return store.addEvent({ ...copyOf(event), ...fields, start, end, repeat: null, series: null, overrideOf: { id: event.id, date: occ.date } });
  }

  // "following": end the series before this date and start a new one here, keeping what was skipped later on.
  const [first, following] = splitAt(series, occ.date);
  store.updateEvent(event.id, { repeat: first });
  const day = start.slice(0, 10);
  const by = daysBetween(occ.date, day);
  const skipped = following.skipped.map((d) => shiftDate(d, by));
  const next: Series | null =
    rule === null
      ? null
      : rule
        ? { ...newSeries(day, rule), skipped }
        : { start: day, repeat: { ...following.repeat, weekdays: shiftWeekdays(following.repeat.weekdays, by) }, skipped };
  const created = store.addEvent({ ...copyOf(event), ...fields, start, end, repeat: null, series: next });
  // One-off copies of later dates now belong to the new series.
  for (const o of overridesOf(store, event)) {
    if (o.overrideOf!.date >= occ.date) store.updateEvent(o.id, { overrideOf: { id: created.id, date: shiftDate(o.overrideOf!.date, by) } });
  }
  return created;
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
 * Deletes one occurrence, this and the following ones, or the whole event (with the one-off copies
 * made from it). Returns a function that puts things back, for the Undo toast.
 */
export function deleteOccurrence(store: PlannerStore, occ: Occurrence, scope: Scope): () => void {
  const event = occ.event;
  const original = event.repeat;
  if (!original || scope === "all" || (scope === "following" && startsSeries(event, occ.date))) {
    const gone = [event, ...(original ? overridesOf(store, event) : [])];
    for (const e of gone) store.deleteEvent(e.id);
    return () => gone.forEach((e) => store.restoreEvent(e.id));
  }
  if (scope === "this") {
    store.updateEvent(event.id, { repeat: skip(original, occ.date) });
    return () => store.updateEvent(event.id, { repeat: original });
  }
  const [first] = splitAt(original, occ.date);
  store.updateEvent(event.id, { repeat: first });
  const later = overridesOf(store, event).filter((o) => o.overrideOf!.date >= occ.date);
  for (const o of later) store.deleteEvent(o.id);
  return () => {
    store.updateEvent(event.id, { repeat: original });
    later.forEach((o) => store.restoreEvent(o.id));
  };
}

/**
 * A standalone copy of one occurrence. A copy of an event from a subscribed calendar goes into the
 * first calendar of your own, never into the subscription.
 */
export function duplicateOccurrence(store: PlannerStore, occ: Occurrence): CalendarEvent {
  const event = occ.event;
  const own = store.getState().calendars.find((c) => c.kind.type === "local");
  const calendarId = event.readOnly ? (own?.id ?? event.calendarId) : event.calendarId;
  return store.addEvent({ ...copyOf(event), calendarId, title: event.title, start: occ.start, end: occ.end, repeat: null, series: null });
}
