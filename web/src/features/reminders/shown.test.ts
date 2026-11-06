import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { KEEP_MS, loadShown, rememberShown } from "./shown";

describe("the shown-reminders list", () => {
  it("is stored for the next leader and forgets keys older than a day", async () => {
    const now = Date.now();
    rememberShown("t1|1", now);
    rememberShown("old|1", now - KEEP_MS - 1000);
    await new Promise((r) => setTimeout(r, 50));
    expect([...(await loadShown(now))]).toEqual(["t1|1"]);
  });
});
