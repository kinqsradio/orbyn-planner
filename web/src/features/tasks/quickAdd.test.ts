import { describe, expect, it } from "vitest";
import { describeParse, parseQuickAdd } from "./quickAdd";

// Saturday 7 November 2026, 10:00 local.
const NOW = new Date(2026, 10, 7, 10, 0);
const LISTS = [
  { id: "inbox", name: "Inbox" },
  { id: "err", name: "Errands" },
  { id: "hp", name: "Home projects" },
];
const parse = (text: string, now = NOW) => parseQuickAdd(text, now, LISTS);

describe("parseQuickAdd", () => {
  it("reads the full example", () => {
    expect(parse("dentist friday 3pm #errands !high")).toEqual({
      title: "dentist",
      due: "2026-11-13T15:00",
      listId: "err",
      priority: "high",
      repeat: null,
    });
  });

  it("leaves plain text as a title", () => {
    expect(parse("buy milk")).toEqual({ title: "buy milk", due: null, listId: null, priority: "none", repeat: null });
    expect(parse("   ")).toMatchObject({ title: "", due: null });
  });

  describe("days", () => {
    it("today and tomorrow", () => {
      expect(parse("call mum today").due).toBe("2026-11-07");
      expect(parse("call mum tomorrow").due).toBe("2026-11-08");
      expect(parse("call mum tmrw").due).toBe("2026-11-08");
    });

    it("weekday names mean the next one after today", () => {
      expect(parse("gym monday").due).toBe("2026-11-09");
      expect(parse("gym mon").due).toBe("2026-11-09");
      expect(parse("gym saturday").due).toBe("2026-11-14");
      expect(parse("gym sun").due).toBe("2026-11-08");
      expect(parse("gym on friday").title).toBe("gym");
    });

    it("next week is next Monday; next friday is in the following week", () => {
      expect(parse("review next week").due).toBe("2026-11-09");
      expect(parse("review next week").title).toBe("review");
      expect(parse("dinner next friday").due).toBe("2026-11-13");
      expect(parse("dinner next monday", new Date(2026, 10, 4, 9, 0)).due).toBe("2026-11-09");
      expect(parse("dinner next friday", new Date(2026, 10, 4, 9, 0)).due).toBe("2026-11-13");
    });

    it("day and month in either order", () => {
      expect(parse("tax 14 nov").due).toBe("2026-11-14");
      expect(parse("tax 14 november").due).toBe("2026-11-14");
      expect(parse("tax nov 14").due).toBe("2026-11-14");
      expect(parse("tax on 1st dec").due).toBe("2026-12-01");
      expect(parse("tax on 1st dec").title).toBe("tax");
      expect(parse("tax 7 nov").due).toBe("2026-11-07");
    });

    it("rolls a passed date into next year", () => {
      expect(parse("renew 2 feb").due).toBe("2027-02-02");
      expect(parse("renew 6 nov").due).toBe("2027-11-06");
    });

    it("ignores impossible dates and bare numbers", () => {
      expect(parse("party 31 nov")).toMatchObject({ title: "party 31 nov", due: null });
      expect(parse("read 3 books").due).toBeNull();
      expect(parse("may be later").due).toBeNull();
    });

    it("reads an ISO date", () => {
      expect(parse("flight 2027-01-05").due).toBe("2027-01-05");
    });
  });

  describe("times", () => {
    it("am, pm and 24-hour times", () => {
      expect(parse("a tomorrow 3pm").due).toBe("2026-11-08T15:00");
      expect(parse("a tomorrow 3:30pm").due).toBe("2026-11-08T15:30");
      expect(parse("a tomorrow 12am").due).toBe("2026-11-08T00:00");
      expect(parse("a tomorrow 12pm").due).toBe("2026-11-08T12:00");
      expect(parse("a tomorrow 9am").due).toBe("2026-11-08T09:00");
      expect(parse("a tomorrow 15:00").due).toBe("2026-11-08T15:00");
      expect(parse("a tomorrow 07:05").due).toBe("2026-11-08T07:05");
    });

    it("drops the word at before a time", () => {
      expect(parse("lunch tomorrow at noon")).toMatchObject({ title: "lunch", due: "2026-11-08T12:00" });
      expect(parse("lunch at 1pm tomorrow").title).toBe("lunch");
    });

    it("a time alone means today, or tomorrow when it has passed", () => {
      expect(parse("stretch 3pm").due).toBe("2026-11-07T15:00");
      expect(parse("stretch 9am").due).toBe("2026-11-08T09:00");
    });

    it("rejects invalid times and keeps bare numbers in the title", () => {
      expect(parse("room 25:00").due).toBeNull();
      expect(parse("room 13pm").due).toBeNull();
      expect(parse("room 12:75").due).toBeNull();
      expect(parse("book 3").due).toBeNull();
    });
  });

  describe("lists and priority", () => {
    it("matches a list case-insensitively, ignoring spaces", () => {
      expect(parse("fix tap #HomeProjects").listId).toBe("hp");
      expect(parse("fix tap #home-projects").listId).toBeNull();
    });

    it("keeps an unknown #tag in the title and the task in the Inbox", () => {
      expect(parse("fix tap #garage")).toMatchObject({ title: "fix tap #garage", listId: null });
    });

    it("priority words and numbers", () => {
      expect(parse("a !high").priority).toBe("high");
      expect(parse("a !med").priority).toBe("medium");
      expect(parse("a !Low").priority).toBe("low");
      expect(parse("a !3").priority).toBe("high");
      expect(parse("a !urgent")).toMatchObject({ title: "a !urgent", priority: "none" });
    });

    it("tokens can come in any order", () => {
      expect(parse("!low #errands pick up parcel 14 nov")).toEqual({
        title: "pick up parcel",
        due: "2026-11-14",
        listId: "err",
        priority: "low",
        repeat: null,
      });
    });
  });

  it("keeps the words when nothing is left to call the task", () => {
    expect(parse("tomorrow")).toEqual({ title: "tomorrow", due: null, listId: null, priority: "none", repeat: null });
    expect(parse("#errands !high")).toMatchObject({ title: "#errands !high", listId: null });
  });

  it("uses only the first day and time", () => {
    expect(parse("trip friday saturday 9am 10am")).toMatchObject({ title: "trip saturday 10am", due: "2026-11-13T09:00" });
  });

  describe("ordinary words are not dates", () => {
    const none = (text: string) => expect(parse(text)).toMatchObject({ title: text, due: null });

    it("short weekdays and months in the middle of a sentence", () => {
      none("wear sun hat");
      none("march 5 miles");
      none("may 3 people come");
      none("read 1 may chapter");
      none("sat nav broken");
      none("watch mon trailer");
    });

    it("an ALL CAPS word is never a date", () => {
      expect(parse("SAT prep sat")).toEqual({ title: "SAT prep", due: "2026-11-14", listId: null, priority: "none", repeat: null });
      none("MAY 5 reports");
    });

    it("they count at the end, or after on, due, by or every", () => {
      expect(parse("dentist on sat")).toMatchObject({ title: "dentist", due: "2026-11-14" });
      expect(parse("pay rent by 1 may")).toMatchObject({ title: "pay rent", due: "2027-05-01" });
      expect(parse("tax due 14 nov")).toMatchObject({ title: "tax", due: "2026-11-14" });
      expect(parse("gym every fri")).toMatchObject({ title: "gym", due: "2026-11-13" });
      expect(parse("lunch sun")).toMatchObject({ title: "lunch", due: "2026-11-08" });
    });

    it("a time, list or priority after the date still leaves it at the end", () => {
      expect(parse("dentist 14 nov 3pm !high")).toMatchObject({ title: "dentist", due: "2026-11-14T15:00", priority: "high" });
      expect(parse("dentist sat at 3pm #errands")).toMatchObject({ title: "dentist", due: "2026-11-14T15:00", listId: "err" });
    });

    it("full weekday names and tomorrow still work anywhere", () => {
      expect(parse("friday dinner with Sam")).toMatchObject({ title: "dinner with Sam", due: "2026-11-13" });
      expect(parse("call the sunday school tomorrow dad")).toMatchObject({ due: "2026-11-08" });
    });
  });

  it("looks up to four years ahead for 29 February", () => {
    expect(parse("leap day on 29 feb").due).toBe("2028-02-29");
    expect(parse("leap day on 29 feb", new Date(2027, 5, 1)).due).toBe("2028-02-29");
    expect(parse("leap day on 29 feb", new Date(2028, 2, 1)).due).toBe("2032-02-29");
    expect(parse("nothing on 30 feb").due).toBeNull();
  });

  describe("words that are also property names", () => {
    it("fix constructor bug", () => {
      expect(parse("fix constructor bug")).toEqual({ title: "fix constructor bug", due: null, listId: null, priority: "none", repeat: null });
      expect(parse("toString and valueOf and __proto__ hasOwnProperty")).toMatchObject({ due: null, listId: null, priority: "none" });
    });

    it("!constructor is not a priority, and next constructor is not a weekday", () => {
      expect(parse("fix it !constructor")).toEqual({ title: "fix it !constructor", due: null, listId: null, priority: "none", repeat: null });
      expect(parse("next constructor")).toMatchObject({ title: "next constructor", due: null });
      expect(parse("fix #constructor")).toMatchObject({ title: "fix #constructor", listId: null });
    });
  });

  describe("describeParse", () => {
    it("summarises what was read", () => {
      const r = parse("dentist friday 3pm #errands !high");
      expect(describeParse(r, LISTS, NOW)).toBe("dentist · due Fri 13 Nov 15:00 · Errands · High");
    });

    it("is empty when the words are plain", () => {
      expect(describeParse(parse("buy milk"), LISTS, NOW)).toBe("");
    });

    it("adds the year when it is not this year", () => {
      expect(describeParse(parse("renew on 2 feb"), LISTS, NOW)).toBe("renew · due Tue 2 Feb 2027");
    });
  });

  describe("every …", () => {
    const every = (text: string) => parse(text);

    it("every fri is a weekly repeat on Friday, starting next Friday", () => {
      expect(every("gym every fri")).toEqual({
        title: "gym",
        due: "2026-11-13",
        listId: null,
        priority: "none",
        repeat: { frequency: "weekly", interval: 1, weekdays: ["fri"], end: { type: "never" } },
      });
      expect(every("gym every Friday 6pm").due).toBe("2026-11-13T18:00");
    });

    it("every day, week, month and year start today", () => {
      expect(every("water plants every day")).toMatchObject({ title: "water plants", due: "2026-11-07", repeat: { frequency: "daily", interval: 1 } });
      expect(every("review every week").repeat).toMatchObject({ frequency: "weekly", interval: 1, weekdays: [] });
      expect(every("pay rent every month").repeat).toMatchObject({ frequency: "monthly" });
      expect(every("renew every year").repeat).toMatchObject({ frequency: "yearly" });
    });

    it("every N units, every other unit and every weekday", () => {
      expect(every("vacuum every 2 weeks").repeat).toMatchObject({ frequency: "weekly", interval: 2 });
      expect(every("pills every 3 days").repeat).toMatchObject({ frequency: "daily", interval: 3 });
      expect(every("bins every other week").repeat).toMatchObject({ frequency: "weekly", interval: 2 });
      expect(every("stand-up every weekday").repeat).toMatchObject({ frequency: "weekly", weekdays: ["mon", "tue", "wed", "thu", "fri"] });
    });

    it("an explicit date wins as the start", () => {
      expect(every("yoga every tue 14 nov on")).toMatchObject({ repeat: { weekdays: ["tue"] } });
      expect(every("yoga every tue on 14 nov")).toMatchObject({ title: "yoga", due: "2026-11-14", repeat: { weekdays: ["tue"] } });
    });

    it("every followed by something else is plain text", () => {
      expect(every("clean every nook")).toEqual({ title: "clean every nook", due: null, listId: null, priority: "none", repeat: null });
      expect(every("every")).toMatchObject({ title: "every", repeat: null });
    });

    it("describes the repeat in the preview", () => {
      expect(describeParse(every("gym every fri"), LISTS, NOW)).toBe("gym · due Fri 13 Nov · every Friday");
      expect(describeParse(every("vacuum every 2 weeks"), LISTS, NOW)).toBe("vacuum · due Sat 7 Nov · every 2 weeks");
    });
  });
});
