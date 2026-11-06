import { describe, expect, it } from "vitest";
import { parseQuickAdd } from "./quickAdd";

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
    });
  });

  it("leaves plain text as a title", () => {
    expect(parse("buy milk")).toEqual({ title: "buy milk", due: null, listId: null, priority: "none" });
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
      expect(parse("!low #errands 14 nov pick up parcel")).toEqual({
        title: "pick up parcel",
        due: "2026-11-14",
        listId: "err",
        priority: "low",
      });
    });
  });

  it("keeps the words when nothing is left to call the task", () => {
    expect(parse("tomorrow")).toEqual({ title: "tomorrow", due: null, listId: null, priority: "none" });
    expect(parse("#errands !high")).toMatchObject({ title: "#errands !high", listId: null });
  });

  it("uses only the first day and time", () => {
    expect(parse("trip friday saturday 9am 10am")).toMatchObject({ title: "trip saturday 10am", due: "2026-11-13T09:00" });
  });
});
