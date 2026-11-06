// Feeds name time zones; the viewer sees their own. This file runs in New York (UTC-5 in November,
// UTC-4 in summer) so the conversions have known answers.
(globalThis as unknown as { process: { env: Record<string, string> } }).process.env.TZ = "America/New_York";

import { describe, expect, it } from "vitest";
import { LocalStore } from "../store/LocalStore";
import { expandEvents } from "../store/occurrences";
import { MemoryPersistence } from "../store/persistence";
import { parseIcs } from "./ics";
import { resolveZone, wallToLocal, zonedInstant } from "./zones";

const feed = (...props: string[]) => ["BEGIN:VCALENDAR", "BEGIN:VEVENT", ...props, "SUMMARY:x", "END:VEVENT", "END:VCALENDAR"].join("\r\n");
const parse = (...props: string[]) => parseIcs(feed(...props))[0]!;
/** The start as the viewer sees it, from the wall time and zone the feed gave. */
const seen = (e: { start: string; zone?: string | null }) => (e.zone ? wallToLocal(e.zone, e.start) : e.start);

describe("time zones in feeds", () => {
  it("the zone is New York in this file", () => {
    expect(new Date(2026, 10, 7, 12).getTimezoneOffset()).toBe(300);
  });

  it("keeps the wall time and the zone, and shows it in the viewer's time", () => {
    const e = parse("DTSTART;TZID=Europe/London:20261107T150000");
    expect(e).toMatchObject({ start: "2026-11-07T15:00", zone: "Europe/London" });
    expect(seen(e)).toBe("2026-11-07T10:00"); // GMT, UTC-5
    expect(seen(parse("DTSTART;TZID=Europe/London:20260707T120000"))).toBe("2026-07-07T07:00"); // BST
    expect(seen(parse("DTSTART;TZID=Asia/Tokyo:20261107T090000"))).toBe("2026-11-06T19:00");
    expect(seen(parse("DTSTART;TZID=America/New_York:20261107T090000"))).toBe("2026-11-07T09:00");
    expect(seen(parse("DTSTART;TZID=Australia/Sydney:20261107T090000"))).toBe("2026-11-06T17:00");
  });

  it("knows common Windows zone names, Mexico's included", () => {
    expect(seen(parse("DTSTART;TZID=GMT Standard Time:20261107T150000"))).toBe("2026-11-07T10:00");
    expect(seen(parse("DTSTART;TZID=Tokyo Standard Time:20261107T090000"))).toBe("2026-11-06T19:00");
    expect(seen(parse("DTSTART;TZID=Eastern Standard Time:20261107T090000"))).toBe("2026-11-07T09:00");
    expect(seen(parse("DTSTART;TZID=Pacific Standard Time:20261107T090000"))).toBe("2026-11-07T12:00");
    expect(seen(parse("DTSTART;TZID=Central Europe Standard Time:20261107T150000"))).toBe("2026-11-07T09:00");
    expect(seen(parse("DTSTART;TZID=AUS Eastern Standard Time:20261107T090000"))).toBe("2026-11-06T17:00");
    expect(seen(parse("DTSTART;TZID=India Standard Time:20261107T090000"))).toBe("2026-11-06T22:30");
    expect(seen(parse("DTSTART;TZID=China Standard Time:20261107T090000"))).toBe("2026-11-06T20:00");
    expect(seen(parse("DTSTART;TZID=Central Standard Time (Mexico):20261107T090000"))).toBe("2026-11-07T10:00");
    expect(seen(parse("DTSTART;TZID=Mountain Standard Time (Mexico):20261107T090000"))).toBe("2026-11-07T11:00");
    expect(resolveZone("Pacific Standard Time (Mexico)")).toBe("America/Tijuana");
    expect(resolveZone("Aleutian Standard Time")).toBe("America/Adak");
  });

  it("an end in another zone becomes the same moment in the start's zone", () => {
    const e = parse("DTSTART;TZID=Europe/London:20261107T150000", "DTEND;TZID=America/New_York:20261107T110000");
    expect([e.start, e.end]).toEqual(["2026-11-07T15:00", "2026-11-07T16:00"]);
  });

  it("an unknown zone is read as floating time, and says so", () => {
    const e = parse("DTSTART;TZID=Mars/Olympus_Mons:20261107T150000");
    expect(e).toMatchObject({ start: "2026-11-07T15:00", zone: null });
    expect(e.notes).toContain("“Mars/Olympus_Mons” isn’t known here");
    expect(parse("DTSTART:20261107T150000").notes).toBe("");
  });

  it("an all-day date has no zone", () => {
    expect(parse("DTSTART;TZID=Asia/Tokyo;VALUE=DATE:20261107")).toMatchObject({ start: "2026-11-07", zone: null });
  });

  it("a weekly rule stays on the days it names, in the source zone", () => {
    const e = parse("DTSTART;TZID=Asia/Tokyo:20261110T090000\r\nRRULE:FREQ=WEEKLY;BYDAY=TU");
    expect(e.series).toMatchObject({ start: "2026-11-10", repeat: { weekdays: ["tue"] } });
    expect(seen(e)).toBe("2026-11-09T19:00"); // Monday evening in New York, Tuesday morning in Tokyo
  });

  it("excluded dates are source-zone dates", () => {
    const e = parse("DTSTART;TZID=Asia/Tokyo:20261110T090000\r\nRRULE:FREQ=DAILY\r\nEXDATE;TZID=Asia/Tokyo:20261112T090000");
    expect(e.series!.skipped).toEqual(["2026-11-12"]);
  });
});

describe("a repeat in a source zone, shown in the viewer's", () => {
  async function weeklyLondon() {
    const store = new LocalStore({ persistence: new MemoryPersistence(), now: () => new Date(2026, 2, 1, 12), broadcast: false });
    await store.ready;
    const sub = store.addSubscription("Team", "c1", "https://example.com/t.ics");
    store.replaceFeedEvents(sub.id, parseIcs(feed("DTSTART;TZID=Europe/London:20260302T140000", "DTEND;TZID=Europe/London:20260302T150000", "RRULE:FREQ=WEEKLY")));
    return store;
  }
  const starts = (store: LocalStore, from: string, to: string) => expandEvents(store.getState().events, from, to).map((o) => o.start);

  it("keeps London's 14:00 through the weeks where the UK and the US change clocks on different days", async () => {
    const store = await weeklyLondon();
    // The US went forward on 8 March, the UK goes forward on 29 March.
    expect(starts(store, "2026-03-01", "2026-04-08")).toEqual([
      "2026-03-02T09:00", // both on standard time
      "2026-03-09T10:00", // US summer, UK still winter
      "2026-03-16T10:00",
      "2026-03-23T10:00",
      "2026-03-30T09:00", // both on summer time
      "2026-04-06T09:00",
    ]);
  });

  it("converts the end too, and places the event on the viewer's day", async () => {
    const store = await weeklyLondon();
    const [first] = expandEvents(store.getState().events, "2026-03-09", "2026-03-09");
    expect([first!.start, first!.end, first!.date]).toEqual(["2026-03-09T10:00", "2026-03-09T11:00", "2026-03-09"]);
  });

  it("an event late in the evening there is on the day before here", async () => {
    const store = new LocalStore({ persistence: new MemoryPersistence(), now: () => new Date(2026, 2, 1, 12), broadcast: false });
    await store.ready;
    const sub = store.addSubscription("Tokyo", "c1", "https://example.com/t.ics");
    store.replaceFeedEvents(sub.id, parseIcs(feed("DTSTART;TZID=Asia/Tokyo:20260310T090000", "DTEND;TZID=Asia/Tokyo:20260310T100000", "RRULE:FREQ=WEEKLY")));
    expect(expandEvents(store.getState().events, "2026-03-09", "2026-03-09").map((o) => o.start)).toEqual(["2026-03-09T20:00"]);
    expect(expandEvents(store.getState().events, "2026-03-10", "2026-03-10")).toEqual([]);
  });

  it("a UTC repeat keeps its UTC time", async () => {
    const store = new LocalStore({ persistence: new MemoryPersistence(), now: () => new Date(2026, 2, 1, 12), broadcast: false });
    await store.ready;
    const sub = store.addSubscription("UTC", "c1", "https://example.com/t.ics");
    store.replaceFeedEvents(sub.id, parseIcs(feed("DTSTART:20260302T140000Z", "DTEND:20260302T150000Z", "RRULE:FREQ=WEEKLY")));
    expect(starts(store, "2026-03-01", "2026-03-16")).toEqual(["2026-03-02T09:00", "2026-03-09T10:00", "2026-03-16T10:00"]);
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
