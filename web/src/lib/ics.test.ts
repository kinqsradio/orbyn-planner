import { describe, expect, it } from "vitest";
import { IcsError, MAX_EVENTS, NOT_SUPPORTED, parseIcs } from "./ics";
import { wallToLocal } from "./zones";

const wrap = (...events: string[]) => ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Test//EN", ...events, "END:VCALENDAR"].join("\r\n");
const vevent = (...props: string[]) => ["BEGIN:VEVENT", ...props, "END:VEVENT"].join("\r\n");

describe("parseIcs", () => {
  it("reads a timed event with place and notes", () => {
    const [e] = parseIcs(
      wrap(vevent("UID:1", "DTSTART:20261107T090000", "DTEND:20261107T110000", "SUMMARY:Team planning", "LOCATION:Room 3", "DESCRIPTION:Bring the plan")),
    );
    expect(e).toEqual({
      title: "Team planning", allDay: false, start: "2026-11-07T09:00", end: "2026-11-07T11:00",
      place: "Room 3", notes: "Bring the plan", series: null, zone: null,
    });
  });

  it("unfolds folded lines and unescapes text", () => {
    const text = wrap(vevent("UID:1", "DTSTART:20261107T090000", "SUMMARY:A very long title that was fol", " ded by the sender\\, with a comma", "DESCRIPTION:Line one\\nLine two\\; done"));
    const [e] = parseIcs(text);
    expect(e!.title).toBe("A very long title that was folded by the sender, with a comma");
    expect(e!.notes).toBe("Line one\nLine two; done");
  });

  it("accepts LF line endings and folds with a tab", () => {
    const [e] = parseIcs("BEGIN:VCALENDAR\nBEGIN:VEVENT\nDTSTART:20261107T090000\nSUMMARY:Tab\n\tbed\nEND:VEVENT\nEND:VCALENDAR\n");
    expect(e!.title).toBe("Tabbed");
  });

  it("keeps a UTC time as UTC, to be converted to the viewer's time when it is shown", () => {
    const [e] = parseIcs(wrap(vevent("DTSTART:20261107T150000Z", "DTEND:20261107T160000Z", "SUMMARY:Call")));
    expect(e).toMatchObject({ start: "2026-11-07T15:00", end: "2026-11-07T16:00", zone: "UTC" });
    expect(wallToLocal("UTC", e!.start)).toMatch(/^2026-11-0[78]T/);
  });

  it("reads all-day dates; DTEND is the day after the last day", () => {
    const events = parseIcs(
      wrap(
        vevent("DTSTART;VALUE=DATE:20261105", "DTEND;VALUE=DATE:20261106", "SUMMARY:Bonfire night"),
        vevent("DTSTART;VALUE=DATE:20261224", "DTEND;VALUE=DATE:20261228", "SUMMARY:Break"),
        vevent("DTSTART;VALUE=DATE:20261201", "SUMMARY:No end"),
      ),
    );
    expect(events.map((e) => [e.allDay, e.start, e.end])).toEqual([
      [true, "2026-11-05", "2026-11-05"],
      [true, "2026-12-24", "2026-12-27"],
      [true, "2026-12-01", "2026-12-01"],
    ]);
  });

  it("uses DURATION when there is no DTEND", () => {
    const [e] = parseIcs(wrap(vevent("DTSTART:20261107T090000", "DURATION:PT1H30M", "SUMMARY:Workshop")));
    expect(e!.end).toBe("2026-11-07T10:30");
  });

  it("reads basic repeat rules", () => {
    const [daily, weekly, counted, until] = parseIcs(
      wrap(
        vevent("DTSTART:20261107T090000", "RRULE:FREQ=DAILY;INTERVAL=2", "SUMMARY:a"),
        vevent("DTSTART:20261102T090000", "RRULE:FREQ=WEEKLY;BYDAY=MO,WE", "SUMMARY:b"),
        vevent("DTSTART:20261102T090000", "RRULE:FREQ=MONTHLY;COUNT=4", "SUMMARY:c"),
        vevent("DTSTART:20261102T090000", "RRULE:FREQ=YEARLY;UNTIL=20301231T000000Z", "SUMMARY:d"),
      ),
    );
    expect(daily!.series).toMatchObject({ start: "2026-11-07", repeat: { frequency: "daily", interval: 2, weekdays: [], end: { type: "never" } } });
    expect(weekly!.series!.repeat).toMatchObject({ frequency: "weekly", weekdays: ["mon", "wed"] });
    expect(counted!.series!.repeat).toMatchObject({ frequency: "monthly", end: { type: "count", value: 4 } });
    expect(until!.series!.repeat.end).toMatchObject({ type: "until" });
  });

  it("keeps EXDATE dates as skipped and drops a replaced instance", () => {
    const events = parseIcs(
      wrap(
        vevent("UID:s", "DTSTART:20261102T090000", "RRULE:FREQ=WEEKLY", "EXDATE:20261109T090000", "SUMMARY:Stand-up"),
        vevent("UID:s", "RECURRENCE-ID:20261116T090000", "DTSTART:20261116T140000", "SUMMARY:Stand-up (late)"),
      ),
    );
    expect(events[0]!.series!.skipped).toEqual(["2026-11-09", "2026-11-16"]);
    expect(events[1]).toMatchObject({ title: "Stand-up (late)", start: "2026-11-16T14:00", series: null });
  });

  it("leaves an event it cannot repeat as a one-off", () => {
    const [e] = parseIcs(wrap(vevent("DTSTART:20261102T090000", "RRULE:FREQ=MONTHLY;BYDAY=1MO", "SUMMARY:First Monday")));
    expect(e).toMatchObject({ title: "First Monday", series: null });
  });

  it("skips cancelled events and events with no start, and names an event with no title", () => {
    const events = parseIcs(
      wrap(
        vevent("DTSTART:20261107T090000", "STATUS:CANCELLED", "SUMMARY:Gone"),
        vevent("SUMMARY:No start"),
        vevent("DTSTART:20261107T090000"),
      ),
    );
    expect(events.map((e) => e.title)).toEqual(["(No title)"]);
  });

  it("refuses text that is not a calendar", () => {
    expect(() => parseIcs("<html>Not found</html>")).toThrow(IcsError);
  });

  it("a cancelled date of a series takes that date out and adds no event", () => {
    const events = parseIcs(
      wrap(
        vevent("UID:s", "DTSTART:20261102T090000", "RRULE:FREQ=WEEKLY", "SUMMARY:Stand-up"),
        vevent("UID:s", "RECURRENCE-ID:20261109T090000", "STATUS:CANCELLED", "DTSTART:20261109T090000", "SUMMARY:Stand-up"),
        vevent("UID:other", "DTSTART:20261110T090000", "STATUS:CANCELLED", "SUMMARY:Gone"),
      ),
    );
    expect(events).toHaveLength(1);
    expect(events[0]!.series!.skipped).toEqual(["2026-11-09"]);
  });

  it("a rule it cannot repeat shows only its first date, with a note, and invents no others", () => {
    const text = wrap(vevent("DTSTART:20261102T090000", "DTEND:20261102T100000", "RRULE:FREQ=MONTHLY;BYDAY=2TU", "SUMMARY:Second Tuesday", "DESCRIPTION:Bring the plan"));
    const [e] = parseIcs(text);
    expect(e).toMatchObject({ series: null, start: "2026-11-02T09:00", end: "2026-11-02T10:00" });
    expect(e!.notes).toBe(`Bring the plan\n\n${NOT_SUPPORTED}`);
  });

  it("COUNT and INTERVAL must be whole numbers in range, or the rule is not supported", () => {
    const rules = ["COUNT=0", "COUNT=abc", "COUNT=1.5", "COUNT=4294967296", "INTERVAL=0", "INTERVAL=65536", "INTERVAL=2.5", "INTERVAL=-1", "INTERVAL=99999999999999"];
    for (const rule of rules) {
      const [e] = parseIcs(wrap(vevent("DTSTART:20261102T090000", `RRULE:FREQ=DAILY;${rule}`, "SUMMARY:x")));
      expect(e!.series, rule).toBeNull();
      expect(e!.notes, rule).toContain("Repeat not supported");
    }
    const [ok] = parseIcs(wrap(vevent("DTSTART:20261102T090000", "RRULE:FREQ=DAILY;COUNT=4294967295;INTERVAL=65535", "SUMMARY:x")));
    expect(ok!.series!.repeat).toMatchObject({ interval: 65535, end: { type: "count", value: 4294967295 } });
  });

  it("ignores what is inside a VALARM", () => {
    const [e] = parseIcs(
      wrap(
        [
          "BEGIN:VEVENT",
          "DTSTART:20261107T090000",
          "SUMMARY:Real title",
          "DESCRIPTION:Real notes",
          "BEGIN:VALARM",
          "ACTION:DISPLAY",
          "DESCRIPTION:Reminder text",
          "SUMMARY:Alarm title",
          "TRIGGER:-PT15M",
          "END:VALARM",
          "LOCATION:Room 3",
          "END:VEVENT",
        ].join("\r\n"),
      ),
    );
    expect(e).toMatchObject({ title: "Real title", notes: "Real notes", place: "Room 3" });
  });

  it("refuses a feed with too many events", () => {
    const many = Array.from({ length: MAX_EVENTS + 1 }, (_, i) => vevent(`UID:${i}`, "DTSTART:20261107T090000", "SUMMARY:x"));
    expect(() => parseIcs(wrap(...many))).toThrow(/more than 5000 events/);
    expect(parseIcs(wrap(...many.slice(0, MAX_EVENTS)))).toHaveLength(MAX_EVENTS);
  });
});
