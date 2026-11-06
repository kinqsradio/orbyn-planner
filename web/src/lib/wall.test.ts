import { describe, expect, it } from "vitest";
import { addWall, dayNumber, daysBetween, lastDayOf, touchesDay, wallMinutes } from "./wall";

describe("wall-clock arithmetic", () => {
  it("adds days and minutes without a time zone", () => {
    expect(addWall("2026-03-08T09:00", 1)).toBe("2026-03-09T09:00");
    expect(addWall("2026-03-08T02:30", 0)).toBe("2026-03-08T02:30"); // a time that does not exist in some zones stays put
    expect(addWall("2026-11-07T23:30", 0, 45)).toBe("2026-11-08T00:15");
    expect(addWall("2026-11-07T00:10", 0, -20)).toBe("2026-11-06T23:50");
    expect(addWall("2026-12-31", 1)).toBe("2027-01-01");
    expect(addWall("2028-02-28", 1)).toBe("2028-02-29");
  });

  it("counts days and minutes between values", () => {
    expect(daysBetween("2026-11-07", "2026-11-14T10:00")).toBe(7);
    expect(wallMinutes("2026-11-07T09:30") - wallMinutes("2026-11-07")).toBe(570);
    expect(dayNumber("1970-01-02")).toBe(1);
    expect(dayNumber("0050-01-01")).toBeLessThan(dayNumber("0100-01-01"));
  });

  it("an end at 00:00 belongs to the day before", () => {
    expect(lastDayOf("2026-11-07T22:00", "2026-11-08T00:00", false)).toBe("2026-11-07");
    expect(lastDayOf("2026-11-07T22:00", "2026-11-08T00:01", false)).toBe("2026-11-08");
    expect(lastDayOf("2026-11-07", "2026-11-08", true)).toBe("2026-11-08"); // an all-day end is the last day already
    expect(lastDayOf("2026-11-07T00:00", "2026-11-07T00:00", false)).toBe("2026-11-07");
  });

  it("touchesDay uses it", () => {
    const night = { start: "2026-11-07T20:00", end: "2026-11-08T00:00", allDay: false };
    expect(touchesDay(night, "2026-11-07")).toBe(true);
    expect(touchesDay(night, "2026-11-08")).toBe(false);
  });
});
