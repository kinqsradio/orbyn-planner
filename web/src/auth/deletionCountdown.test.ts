import { describe, expect, it } from "vitest";
import { deletionCountdown } from "./deletionNotice";

describe("the deletion banner's countdown", () => {
  const at = "2026-11-14T09:00:00Z";
  it("counts whole days before the last day", () => {
    expect(deletionCountdown(at, new Date("2026-11-08T10:00:00Z"))).toMatch(/^on \w+ 14 November, in 6 days$/);
    // The day before is still the days form, even with under 24 hours left: "today" is the same UTC day.
    expect(deletionCountdown(at, new Date("2026-11-12T10:00:00Z"))).toMatch(/^on \w+ 14 November, in 2 days$/);
    // The UTC day before: "tomorrow", with the hours left.
    expect(deletionCountdown(at, new Date("2026-11-13T10:00:00Z"))).toBe("tomorrow at 09:00 UTC, in 23 hours");
    expect(deletionCountdown("2026-11-14T12:00:00Z", new Date("2026-11-13T13:00:00Z"))).toBe("tomorrow at 12:00 UTC, in 23 hours");
    expect(deletionCountdown("2026-11-14T00:30:00Z", new Date("2026-11-13T23:50:00Z"))).toBe("tomorrow at 00:30 UTC, in under an hour"); // by the UTC calendar, not a 24-hour count
  });
  it("on the last day says the time in UTC and the hours left, then 'in under an hour'", () => {
    expect(deletionCountdown(at, new Date("2026-11-14T04:00:00Z"))).toBe("today at 09:00 UTC, in 5 hours");
    expect(deletionCountdown(at, new Date("2026-11-14T08:00:00Z"))).toBe("today at 09:00 UTC, in 1 hour");
    expect(deletionCountdown(at, new Date("2026-11-14T08:30:00Z"))).toBe("today at 09:00 UTC, in under an hour");
  });
});
