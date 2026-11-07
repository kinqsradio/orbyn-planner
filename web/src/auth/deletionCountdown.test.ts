import { describe, expect, it } from "vitest";
import { deletionCountdown } from "./deletionNotice";

describe("the deletion banner's countdown", () => {
  const at = "2026-11-14T09:00:00Z";
  it("counts whole days before the last day", () => {
    expect(deletionCountdown(at, new Date("2026-11-08T10:00:00Z"))).toMatch(/^on \w+ 14 November, in 5 days$/);
    expect(deletionCountdown(at, new Date("2026-11-13T10:00:00Z"))).toMatch(/^today at 09:00 UTC, in 23 hours$/);
  });
  it("on the last day says the time in UTC and the hours left, then 'in under an hour'", () => {
    expect(deletionCountdown(at, new Date("2026-11-14T04:00:00Z"))).toBe("today at 09:00 UTC, in 5 hours");
    expect(deletionCountdown(at, new Date("2026-11-14T08:00:00Z"))).toBe("today at 09:00 UTC, in 1 hour");
    expect(deletionCountdown(at, new Date("2026-11-14T08:30:00Z"))).toBe("today at 09:00 UTC, in under an hour");
  });
});
