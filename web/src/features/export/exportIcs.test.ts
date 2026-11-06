import { describe, expect, it } from "vitest";
import { newSeries, type Repeat } from "../../store/repeat";
import type { CalendarEvent, PlannerCalendar, Tag, Task, TaskList } from "../../store/types";
import { buildIcs, fold } from "./exportIcs";

const NOW = new Date("2026-11-07T10:00:00Z");
const never = (frequency: Repeat["frequency"], more: Partial<Repeat> = {}): Repeat => ({ frequency, interval: 1, weekdays: [], end: { type: "never" }, ...more });

const event = (over: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: "e1", title: "Dentist", calendarId: "personal", allDay: false, start: "2026-11-14T15:00", end: "2026-11-14T16:00", place: "", notes: "", people: [], reminder: null,
  repeat: null, zone: null, overrideOf: null, readOnly: false, deletedAt: null, createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z", ...over,
});
const task = (over: Partial<Task> = {}): Task => ({
  id: "t1", title: "Send the brief", notes: "", listId: "inbox", due: "2026-11-07T12:00", priority: "none", done: false, completedAt: null, deletedAt: null, checklist: [],
  tags: [], projectId: null, sectionId: null, repeat: null, reminder: null, completions: [], overrideOf: null, createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z", ...over,
});
const lists: TaskList[] = [{ id: "inbox", name: "Inbox", colour: "c1", isInbox: true }];
const calendars: PlannerCalendar[] = [
  { id: "personal", name: "Personal", colour: "c2", visible: true, kind: { type: "local" } },
  { id: "feed", name: "Holidays", colour: "c3", visible: true, kind: { type: "subscribed", url: "https://example.com/h.ics", lastRefreshed: null, error: null } },
];
const unfolded = (ics: string) => ics.replace(/\r\n /g, "").split("\r\n");

interface Case {
  name: string;
  events?: CalendarEvent[];
  tasks?: Task[];
  tags?: Tag[];
  has?: string[];
  lacks?: string[];
}

const cases: Case[] = [
  { name: "a timed event is floating wall time with a summary", events: [event()], has: ["BEGIN:VEVENT", "UID:e1@orbyn-planner", "DTSTAMP:20261107T100000Z", "DTSTART:20261114T150000", "DTEND:20261114T160000", "SUMMARY:Dentist"] },
  { name: "an all-day event ends the day after its last day", events: [event({ allDay: true, start: "2026-12-24", end: "2026-12-26" })], has: ["DTSTART;VALUE=DATE:20261224", "DTEND;VALUE=DATE:20261227"] },
  { name: "text is escaped, and place, notes, people and a reminder are kept", events: [event({ title: "Lunch, then; a\\b", place: "Room 3", notes: "line1\nline2", people: [{ email: "maya@example.com", response: "accepted" }, { email: "x@example.com", response: "none" }], reminder: 15 })], has: [String.raw`SUMMARY:Lunch\, then\; a\\b`, "LOCATION:Room 3", "DESCRIPTION:line1\\nline2", "ATTENDEE;PARTSTAT=ACCEPTED:mailto:maya@example.com", "ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:x@example.com", "TRIGGER:-PT15M"] },
  { name: "a weekly repeat with days, an interval and a count is one RRULE", events: [event({ repeat: newSeries("2026-11-14", never("weekly", { interval: 2, weekdays: ["mon", "fri"], end: { type: "count", value: 6 } })) })], has: ["RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,FR;COUNT=6"] },
  { name: "a timed series that ends on a date runs to the end of that day, and skipped dates are EXDATE", events: [event({ repeat: { ...newSeries("2026-11-14", never("daily", { end: { type: "until", value: "2026-12-01" } })), skipped: ["2026-11-16"] } })], has: ["RRULE:FREQ=DAILY;UNTIL=20261201T235959", "EXDATE:20261116T150000"] },
  { name: "an all-day series uses date values for UNTIL and EXDATE", events: [event({ allDay: true, start: "2026-11-14", end: "2026-11-14", repeat: { ...newSeries("2026-11-14", never("yearly", { end: { type: "until", value: "2030-11-14" } })), skipped: ["2027-11-14"] } })], has: ["RRULE:FREQ=YEARLY;UNTIL=20301114", "EXDATE;VALUE=DATE:20271114"] },
  {
    name: "one changed occurrence replaces its date: RECURRENCE-ID on the series' UID, and no EXDATE for it",
    events: [
      event({ repeat: { ...newSeries("2026-11-14", never("weekly")), skipped: ["2026-11-21"] } }),
      event({ id: "e2", title: "Moved", start: "2026-11-21T17:00", end: "2026-11-21T18:00", overrideOf: { id: "e1", date: "2026-11-21" } }),
    ],
    has: ["UID:e1@orbyn-planner", "RECURRENCE-ID:20261121T150000", "SUMMARY:Moved"],
    lacks: ["EXDATE", "UID:e2@orbyn-planner"],
  },
  { name: "deleted events, and the events of a subscribed calendar, are left out", events: [event({ id: "gone", title: "Deleted", deletedAt: "2026-11-02T00:00:00Z" }), event({ id: "feed1", title: "Public holiday", calendarId: "feed", readOnly: true })], lacks: ["Deleted", "Public holiday", "BEGIN:VEVENT"] },
  { name: "a task with a due time is a VTODO with priority, its list as category and a reminder", tasks: [task({ priority: "high", reminder: 30 })], has: ["BEGIN:VTODO", "UID:t1@orbyn-planner", "DUE:20261107T120000", "SUMMARY:Send the brief", "CATEGORIES:Inbox", "PRIORITY:1", "STATUS:NEEDS-ACTION", "TRIGGER:-PT30M"] },
  { name: "a task's tags join its list as categories, and a deleted tag is not one", tasks: [task({ tags: ["g1", "g2", "gone"] })], tags: [{ id: "g1", name: "Work", colour: "c1", deletedAt: null }, { id: "g2", name: "Q4, planning", colour: "c2", deletedAt: null }, { id: "gone", name: "Old", colour: "c3", deletedAt: "2026-11-01T00:00:00Z" }], has: [String.raw`CATEGORIES:Inbox,Work,Q4\, planning`] },
  { name: "a done task is COMPLETED with its time in UTC", tasks: [task({ due: "2026-11-07", done: true, completedAt: "2026-11-07T09:30:00.000Z" })], has: ["DUE;VALUE=DATE:20261107", "STATUS:COMPLETED", "COMPLETED:20261107T093000Z"] },
  { name: "a repeating task has DTSTART at the series start and an RRULE", tasks: [task({ due: "2026-11-21", repeat: newSeries("2026-11-07", never("weekly")) })], has: ["DTSTART;VALUE=DATE:20261107", "DUE;VALUE=DATE:20261121", "RRULE:FREQ=WEEKLY"] },
  { name: "an attendee address that could break the file is left out", events: [event({ people: [{ email: "a@b.com\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nSUMMARY:Injected", response: "none" }, { email: "ok@example.com", response: "none" }] })], has: ["ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:ok@example.com"], lacks: ["Injected", "a@b.com"] },
  { name: "control characters are dropped from text, and a lone CR is a line break", events: [event({ title: "A\u0000B\u001bC", notes: "one\rtwo" })], has: ["SUMMARY:ABC", "DESCRIPTION:one\\ntwo"] },
  { name: "a date-only reminder counts from 09:00, as the planner reminds", tasks: [task({ due: "2026-11-07", reminder: 30 }), task({ id: "t2", due: "2026-11-08", reminder: 600 })], has: ["TRIGGER:PT510M", "TRIGGER:-PT60M"] },
  { name: "tasks without a due date, and deleted tasks, are left out", tasks: [task({ id: "nodue", title: "Someday", due: null }), task({ id: "del", title: "Deleted task", deletedAt: "2026-11-02T00:00:00Z" })], lacks: ["Someday", "Deleted task", "BEGIN:VTODO"] },
];

describe("the .ics export", () => {
  it.each(cases)("$name", ({ events = [], tasks = [], tags = [], has = [], lacks = [] }) => {
    const ics = buildIcs({ lists, calendars, events, tasks, tags }, NOW);
    const lines = unfolded(ics);
    expect(lines.slice(0, 4)).toEqual(["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Orbyn//Planner//EN", "CALSCALE:GREGORIAN"]);
    expect(lines.at(-2)).toBe("END:VCALENDAR");
    expect(ics.endsWith("\r\n")).toBe(true);
    for (const line of has) expect(lines).toContain(line);
    for (const part of lacks) expect(lines.some((l) => l.includes(part))).toBe(false);
  });

  it("folds long lines at 75 octets without splitting a character", () => {
    const title = "é".repeat(100);
    const ics = buildIcs({ lists, calendars, events: [event({ title })], tasks: [] }, NOW);
    for (const physical of ics.split("\r\n")) expect(new TextEncoder().encode(physical).length).toBeLessThanOrEqual(75);
    expect(unfolded(ics)).toContain(`SUMMARY:${title}`);
    expect(fold("short")).toEqual(["short"]);
  });
});
