import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { forgetDeviceDataAnswers, deviceDataAnswer } from "../../store/deviceData";
import { closeAllPlanners, plannerFor } from "../../store/planners";
import { DeviceDataOffer } from "./DeviceDataOffer";

const A = "00000000-0000-4000-8000-0000000000a1";
const B = "00000000-0000-4000-8000-0000000000b1";
const QUESTION = "Add this device’s planner to your account?";

beforeEach(() => {
  closeAllPlanners();
  globalThis.indexedDB = new IDBFactory();
  forgetDeviceDataAnswers();
});
afterEach(cleanup);

async function deviceHas(title: string) {
  const device = plannerFor(null);
  await device.ready;
  device.addTask({ title });
  await device.flush();
  closeAllPlanners();
}

const titlesOf = async (id: string | null) => {
  const s = plannerFor(id);
  await s.ready;
  const titles = s.getState().tasks.map((t) => t.title);
  closeAllPlanners();
  return titles;
};

describe("adding this device's planner to the account", () => {
  it("asks nothing when the device holds nothing", async () => {
    render(<DeviceDataOffer accountId={A} />);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText(QUESTION)).toBeNull();
    expect(deviceDataAnswer(A)).toBeNull(); // not answered, so it can ask later if something is made
  });

  it("Add to account moves the records into the account's planner and empties the device's", async () => {
    await deviceHas("Made before signing in");
    const view = render(<DeviceDataOffer accountId={A} />);
    await userEvent.click(await screen.findByRole("button", { name: "Add to account" }));
    await waitFor(() => expect(screen.queryByText(QUESTION)).toBeNull());
    const account = plannerFor(A);
    await account.ready;
    expect(account.getState().tasks.map((t) => t.title)).toEqual(["Made before signing in"]);
    expect(account.getState().outbox.some((o) => o.type === "task" && o.op === "create")).toBe(true); // it uploads the normal way
    closeAllPlanners();
    expect(await titlesOf(null)).toEqual([]);
    expect(deviceDataAnswer(A)).toBe("added");
    view.unmount();
    render(<DeviceDataOffer accountId={A} />); // the question doesn't come back
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText(QUESTION)).toBeNull();
  });

  it("Keep separate leaves both planners as they are, and the question doesn't come back", async () => {
    await deviceHas("Stays on the device");
    const view = render(<DeviceDataOffer accountId={A} />);
    expect(screen.queryByText(QUESTION)).toBeNull();
    await userEvent.click(await screen.findByRole("button", { name: "Keep separate" }));
    await waitFor(() => expect(screen.queryByText(QUESTION)).toBeNull());
    expect(deviceDataAnswer(A)).toBe("separate");
    closeAllPlanners();
    expect(await titlesOf(null)).toEqual(["Stays on the device"]);
    expect(await titlesOf(A)).toEqual([]);
    view.unmount();
    render(<DeviceDataOffer accountId={A} />);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText(QUESTION)).toBeNull();
  });

  it("is asked once per account: a different account on the same browser is asked too", async () => {
    await deviceHas("Shared choice");
    const first = render(<DeviceDataOffer accountId={A} />);
    await userEvent.click(await screen.findByRole("button", { name: "Keep separate" }));
    await waitFor(() => expect(screen.queryByText(QUESTION)).toBeNull());
    first.unmount();
    render(<DeviceDataOffer accountId={B} />);
    expect(await screen.findByText(QUESTION)).toBeTruthy();
  });
});
