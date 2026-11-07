// Feeds name time zones; the viewer sees their own. This file runs in New York (UTC-5 in November,
// UTC-4 in summer) so the conversions have known answers.
(globalThis as unknown as { process: { env: Record<string, string> } }).process.env.TZ = "America/New_York";

import { describe, expect, it, vi } from "vitest";
import { LocalStore } from "../store/LocalStore";
import { expandEvents } from "../store/occurrences";
import { MemoryPersistence } from "../store/persistence";
import { parseIcs } from "./ics";
import { resolveZone, wallToLocal, zonedInstant } from "./zones";

const zoneWork = vi.hoisted(() => ({ wallToLocal: 0 }));
vi.mock("./zones", async (original) => {
  const real = await original<typeof import("./zones")>();
  return { ...real, wallToLocal: (...args: Parameters<typeof real.wallToLocal>) => (zoneWork.wallToLocal++, real.wallToLocal(...args)) };
});

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

describe("UTC moments in a zoned series", () => {
  const dates = (e: { start: string; zone?: string | null; series?: unknown }, from: string, to: string) => {
    const ev = { ...e, id: "x", deletedAt: null, repeat: e.series, allDay: false, end: e.start } as never;
    return expandEvents([ev], from, to).map((o) => o.date);
  };
  it("UNTIL in UTC is the date in the series' zone: Tokyo 08:00 weekly gives 2", () => {
    const e = parse("DTSTART;TZID=Asia/Tokyo:20261102T080000", "RRULE:FREQ=WEEKLY;UNTIL=20261109T230000Z");
    expect(e.series!.repeat.end).toEqual({ type: "until", value: "2026-11-10" });
    expect(dates(e, "2026-10-25", "2026-12-31")).toHaveLength(2);
  });
  it("EXDATE in UTC hides the right date: LA 18:00 weekly, 11-10 02:00Z is 11-09", () => {
    const e = parse("DTSTART;TZID=America/Los_Angeles:20261102T180000", "RRULE:FREQ=WEEKLY", "EXDATE:20261110T020000Z");
    expect(e.series!.skipped).toEqual(["2026-11-09"]);
  });
  it("RECURRENCE-ID in UTC replaces that occurrence instead of adding one", () => {
    const all = parseIcs(
      [
        "BEGIN:VCALENDAR",
        "BEGIN:VEVENT", "UID:a", "DTSTART;TZID=America/Los_Angeles:20261102T180000", "RRULE:FREQ=WEEKLY", "SUMMARY:m", "END:VEVENT",
        "BEGIN:VEVENT", "UID:a", "RECURRENCE-ID:20261110T020000Z", "DTSTART;TZID=America/Los_Angeles:20261109T190000", "SUMMARY:moved", "END:VEVENT",
        "END:VCALENDAR",
      ].join("\r\n"),
    );
    expect(all.find((x) => x.series)!.series!.skipped).toEqual(["2026-11-09"]);
  });
});

describe("source-zone clock changes and speed", () => {
  it("a start in a skipped hour moves forward by the gap, and keeps the written length", () => {
    // London springs forward on 29 March 2026: 01:30 does not exist, 01:30-02:15 is 45 minutes.
    const e = parse("DTSTART;TZID=Europe/London:20260329T013000", "DTEND;TZID=Europe/London:20260329T021500");
    const ev = { ...e, id: "x", deletedAt: null, repeat: null, allDay: false } as never;
    const [o] = expandEvents([ev], "2026-03-28", "2026-03-30");
    // 02:30 BST is 01:30 UTC, 21:30 the evening before in New York.
    expect(o!.start).toBe("2026-03-28T21:30");
    expect(o!.end).toBe("2026-03-28T22:15");
  });

  it("a grid of daily London events expands every occurrence with a bounded amount of zone work, and a second look at the same days does none", () => {
    const events = Array.from({ length: 100 }, (_, i) => {
      const e = parse("DTSTART;TZID=Europe/London:20261101T090000", "DTEND;TZID=Europe/London:20261101T100000", "RRULE:FREQ=DAILY");
      return { ...e, id: String(i), deletedAt: null, repeat: e.series, allDay: false } as never;
    });
    // Counted by work done (zone conversions), not by the clock: a runaway expansion shows here whatever the machine's load.
    const before = zoneWork.wallToLocal;
    expect(expandEvents(events, "2026-11-01", "2026-12-12")).toHaveLength(100 * 42);
    const first = zoneWork.wallToLocal - before;
    expect(first).toBeLessThanOrEqual(100 * (42 + 4) * 2); // a start and an end per occurrence, plus the two days either side
    expect(first).toBeGreaterThan(0);
    expect(expandEvents(events, "2026-11-01", "2026-12-12")).toHaveLength(100 * 42);
    expect(zoneWork.wallToLocal - before).toBe(first); // the same days again come from the cache
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
