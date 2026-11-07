import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pendingChange, readConfirmed, recordReport } from "../auth/protectionNotice";
import type { ProtectionReport } from "../auth/flows";
import { browserStorage, setMemoryOnly } from "./browserStorage";

beforeEach(() => localStorage.clear());
afterEach(() => setMemoryOnly(false));

const report: ProtectionReport = {
  seq: 2, state: "verified", level: "standard", stopped: null, problem: null,
  head: { level: "standard", seq: 2, prev: "p", signed_at: 1_793_000_000n, signer_device_id: "d2", signature: "s" },
  signer: { id: "d2", listed: true, thisDevice: false }, changedBy: { id: "d2" },
};

describe("what the account screens remember", () => {
  it("reaches localStorage normally, and never while the keys are held in memory only", () => {
    setMemoryOnly(true);
    browserStorage.set("orbyn-planner.x", "1");
    recordReport("acct-1", report);
    expect(localStorage.length).toBe(0); // nothing was written
    expect(readConfirmed("acct-1")).toMatchObject({ seq: 2 }); // but this tab still remembers it
    expect(pendingChange("acct-1", report)).toMatchObject({ seq: 2 });
    setMemoryOnly(false); // the memory goes with the held state
    expect(readConfirmed("acct-1")).toBeNull();
    recordReport("acct-1", report);
    expect(localStorage.length).toBeGreaterThan(0);
  });
});

describe("pendingChange", () => {
  it("reports a change by another device only for a setting this browser verified, and only the one it was recorded for", () => {
    recordReport("acct-1", report);
    expect(pendingChange("acct-1", report)).not.toBeNull();
    expect(pendingChange("acct-1", { ...report, state: "provisional" })).toBeNull(); // not verified: names no one
    expect(pendingChange("acct-1", { ...report, problem: "fork", state: "provisional" })).toBeNull();
    expect(pendingChange("acct-1", { ...report, seq: 1 })).toBeNull(); // another setting than the one recorded
  });
});
