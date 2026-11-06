import { IDBFactory } from "fake-indexeddb";
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { closeAllPlanners, closePlanner, plannerFor, removeAccountPlanner } from "./planners";

beforeEach(() => {
  closeAllPlanners();
  globalThis.indexedDB = new IDBFactory();
});

const A = "00000000-0000-4000-8000-0000000000a1";
const B = "00000000-0000-4000-8000-0000000000b1";
const names = async () => (await indexedDB.databases()).map((d) => d.name);

describe("a planner per account", () => {
  it("a second account never sees the first account's records or outbox, nor the device-only planner's", async () => {
    const a = plannerFor(A);
    await a.ready;
    a.addTask({ title: "Account A's secret" });
    await a.flush();
    expect(a.getState().outbox.length).toBeGreaterThan(0);
    closePlanner(A);

    const b = plannerFor(B);
    await b.ready;
    expect(b.getState().tasks).toEqual([]);
    expect(b.getState().outbox.filter((o) => o.type === "task")).toEqual([]);
    closePlanner(B);

    const device = plannerFor(null);
    await device.ready;
    expect(device.getState().tasks).toEqual([]);
    device.addTask({ title: "Only on this device" });
    await device.flush();
    closePlanner(A);

    // Each opens again with its own, and only its own.
    const aAgain = plannerFor(A);
    await aAgain.ready;
    expect(aAgain.getState().tasks.map((t) => t.title)).toEqual(["Account A's secret"]);
    expect(aAgain.getState().outbox.some((o) => o.type === "task")).toBe(true); // its unsent changes wait for this account
    const bAgain = plannerFor(B);
    await bAgain.ready;
    expect(bAgain.getState().tasks).toEqual([]);
    expect(await names()).toEqual(expect.arrayContaining(["orbyn-planner", `orbyn-planner-account-${A}`, `orbyn-planner-account-${B}`]));
  });

  it("Remove deletes the account's database, outbox included; Keep leaves it", async () => {
    const a = plannerFor(A);
    await a.ready;
    a.addTask({ title: "Mine" });
    await a.flush();
    const b = plannerFor(B);
    await b.ready;
    b.addTask({ title: "Theirs" });
    await b.flush();

    closePlanner(B); // Keep on this browser
    await removeAccountPlanner(A); // Remove

    expect(await names()).not.toContain(`orbyn-planner-account-${A}`);
    expect(await names()).toContain(`orbyn-planner-account-${B}`);
    const aAgain = plannerFor(A);
    await aAgain.ready;
    expect(aAgain.getState().tasks).toEqual([]); // gone, with its unsent changes
    const bAgain = plannerFor(B);
    await bAgain.ready;
    expect(bAgain.getState().tasks.map((t) => t.title)).toEqual(["Theirs"]);
  });
});
