// Feeds name time zones; the viewer sees their own. This file runs in New York (UTC-5 in November,
// UTC-4 in summer) so the conversions have known answers.
(globalThis as unknown as { process: { env: Record<string, string> } }).process.env.TZ = "America/New_York";

import { describe, expect, it } from "vitest";
import { parseIcs } from "./ics";
import { resolveZone, zonedInstant } from "./zones";

const feed = (...props: string[]) => ["BEGIN:VCALENDAR", "BEGIN:VEVENT", ...props, "SUMMARY:x", "END:VEVENT", "END:VCALENDAR"].join("\r\n");
const start = (line: string) => parseIcs(feed(line))[0]!;

describe("time zones in feeds", () => {
  it("the zone is New York in this file", () => {
    expect(new Date(2026, 10, 7, 12).getTimezoneOffset()).toBe(300);
  });

  it("converts an IANA zone to the viewer's time", () => {
    expect(start("DTSTART;TZID=Europe/London:20261107T150000").start).toBe("2026-11-07T10:00"); // GMT
    expect(start("DTSTART;TZID=Europe/London:20260707T120000").start).toBe("2026-07-07T07:00"); // BST
    expect(start("DTSTART;TZID=Asia/Tokyo:20261107T090000").start).toBe("2026-11-06T19:00");
    expect(start("DTSTART;TZID=America/New_York:20261107T090000").start).toBe("2026-11-07T09:00");
    expect(start("DTSTART;TZID=Australia/Sydney:20261107T090000").start).toBe("2026-11-06T17:00"); // AEDT, UTC+11
  });

  it("converts common Windows zone names", () => {
    expect(start("DTSTART;TZID=GMT Standard Time:20261107T150000").start).toBe("2026-11-07T10:00");
    expect(start("DTSTART;TZID=Tokyo Standard Time:20261107T090000").start).toBe("2026-11-06T19:00");
    expect(start("DTSTART;TZID=Eastern Standard Time:20261107T090000").start).toBe("2026-11-07T09:00");
    expect(start("DTSTART;TZID=Pacific Standard Time:20261107T090000").start).toBe("2026-11-07T12:00");
    expect(start("DTSTART;TZID=Central Europe Standard Time:20261107T150000").start).toBe("2026-11-07T09:00");
    expect(start("DTSTART;TZID=AUS Eastern Standard Time:20261107T090000").start).toBe("2026-11-06T17:00");
    expect(start("DTSTART;TZID=India Standard Time:20261107T090000").start).toBe("2026-11-06T22:30");
    expect(start("DTSTART;TZID=China Standard Time:20261107T090000").start).toBe("2026-11-06T20:00");
  });

  it("converts the end in the same zone", () => {
    const e = parseIcs(feed("DTSTART;TZID=Europe/London:20261107T150000", "DTEND;TZID=Europe/London:20261107T160000"))[0]!;
    expect([e.start, e.end]).toEqual(["2026-11-07T10:00", "2026-11-07T11:00"]);
  });

  it("an unknown zone is read as floating time, and says so", () => {
    const e = start("DTSTART;TZID=Mars/Olympus_Mons:20261107T150000");
    expect(e.start).toBe("2026-11-07T15:00");
    expect(e.notes).toContain("“Mars/Olympus_Mons” isn’t known here");
    expect(start("DTSTART:20261107T150000").notes).toBe("");
  });

  it("an all-day date is not converted", () => {
    expect(start("DTSTART;TZID=Asia/Tokyo;VALUE=DATE:20261107").start).toBe("2026-11-07");
  });

  it("a weekly rule follows the day the conversion moves the start to", () => {
    // Tuesday 09:00 in Tokyo is Monday 19:00 in New York.
    const e = start("DTSTART;TZID=Asia/Tokyo:20261110T090000\r\nRRULE:FREQ=WEEKLY;BYDAY=TU");
    expect(e.start).toBe("2026-11-09T19:00");
    expect(e.series).toMatchObject({ start: "2026-11-09", repeat: { weekdays: ["mon"] } });
  });

  it("excluded dates are converted too", () => {
    const e = start("DTSTART;TZID=Asia/Tokyo:20261110T090000\r\nRRULE:FREQ=DAILY\r\nEXDATE;TZID=Asia/Tokyo:20261112T090000");
    expect(e.series!.skipped).toEqual(["2026-11-11"]);
  });
});

describe("zones", () => {
  it("resolves IANA and Windows names and rejects others", () => {
    expect(resolveZone("Europe/London")).toBe("Europe/London");
    expect(resolveZone('"Tokyo Standard Time"')).toBe("Asia/Tokyo");
    expect(resolveZone("Nowhere/Land")).toBeNull();
    expect(resolveZone("")).toBeNull();
  });

  it("a time that does not exist takes the offset from before the change", () => {
    // 02:30 on 8 March 2026 does not exist in New York (clocks went from 02:00 to 03:00).
    const at = zonedInstant("America/New_York", 2026, 3, 8, 2, 30)!;
    expect(at.toISOString()).toBe("2026-03-08T07:30:00.000Z");
  });
});
