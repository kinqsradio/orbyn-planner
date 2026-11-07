import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiFailure } from "../../api/auth";
import type { ProtectionReport } from "../../auth/flows";
import type { ProtectionLink } from "../../generated/ProtectionLink";
import { ProtectionSettings } from "./ProtectionSettings";

const read = vi.fn<() => Promise<ProtectionReport>>();
const confirm = vi.fn();
vi.mock("../../auth/flows", () => ({ readProtection: () => read(), confirmProtection: (...args: unknown[]) => confirm(...args) }));
vi.mock("../../auth/AuthProvider", () => ({
  useAuth: () => ({ services: {}, session: { accountId: "acct-1", deviceState: "trusted", deviceId: "d1" } }),
}));

const link = (seq: number, signedAt: number): ProtectionLink => ({ level: "standard", seq, prev: "p", signed_at: BigInt(signedAt), signer_device_id: "d2", signature: "s" });
const secs = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
const report = (over: Partial<ProtectionReport>): ProtectionReport => ({
  seq: 1, state: "verified", level: "standard", stopped: null, problem: null, head: link(1, secs("2026-11-03T09:00:00Z")),
  signer: { id: "d2", name: "MacBook Air", thisDevice: false }, changedBy: null, ...over,
});

beforeEach(() => {
  localStorage.clear();
  read.mockReset();
  confirm.mockReset();
});
afterEach(cleanup);

const card = () => screen.findByLabelText("Protection");

describe("the protection card", () => {
  it("a setting this device has not confirmed asks once; Not now is remembered, and Confirm signs that setting", async () => {
    read.mockResolvedValue(report({ state: "provisional", seq: 0 }));
    const first = render(<ProtectionSettings />);
    const dialog = await screen.findByRole("dialog", { name: "Confirm your protection level" });
    expect(dialog).toHaveTextContent("Your account uses Standard protection: data is encrypted on your devices, and Orbyn keeps a recovery copy of the keys.");
    expect(within(dialog).getByText("Set on").parentElement).toHaveTextContent("MacBook Air · 3 Nov");
    expect(within(dialog).getByRole("button", { name: "Not now" })).toHaveFocus(); // the safe choice has focus
    await userEvent.click(within(dialog).getByRole("button", { name: "Not now" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(await card()).toHaveTextContent("Confirming");
    first.unmount();
    render(<ProtectionSettings />); // another visit: no second ask for the same setting
    await card();
    expect(screen.queryByRole("dialog")).toBeNull();

    // A newer setting asks again, and Confirm signs it after the head.
    read.mockResolvedValue(report({ state: "provisional", seq: 0, head: link(2, secs("2026-11-04T09:00:00Z")) }));
    cleanup();
    render(<ProtectionSettings />);
    await userEvent.click(await screen.findByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(confirm).toHaveBeenCalledWith(expect.anything(), expect.anything(), "standard", expect.objectContaining({ seq: 2 })));
  });

  it("when another device changed it first, the dialog refreshes, says so in blue, and asks again", async () => {
    read.mockResolvedValueOnce(report({ state: "provisional", seq: 0 }));
    read.mockResolvedValue(report({ state: "provisional", seq: 0, head: link(2, Math.floor(Date.now() / 1000)), signer: { id: "d3", name: "iPhone 16", thisDevice: false } }));
    confirm.mockRejectedValueOnce(new ApiFailure("protection_conflict", 409, "Another device changed the protection level first."));
    render(<ProtectionSettings />);
    await userEvent.click(await screen.findByRole("button", { name: "Confirm" }));
    expect(await screen.findByText("Protection was just changed on iPhone 16, so this shows the current setting. Check it and confirm again.")).toBeInTheDocument();
    expect(await screen.findByText(/iPhone 16 · just now/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm" })).toBeEnabled();
  });

  it("after a rollback or a fork there is nothing to confirm: the line points to a trusted device, and Details is there", async () => {
    localStorage.setItem("orbyn-planner.protection-confirmed.acct-1", JSON.stringify({ seq: 1, level: "standard", at: secs("2026-11-03T09:00:00Z") }));
    read.mockResolvedValue(report({ problem: "rollback", state: "provisional" }));
    render(<ProtectionSettings />);
    const c = await card();
    expect(await within(c).findByText("Standard protection, last confirmed 3 Nov")).toBeInTheDocument();
    expect(c).toHaveTextContent("Can’t confirm");
    expect(c).toHaveTextContent("Open Orbyn on a trusted device to fix this.");
    expect(within(c).queryByRole("button", { name: /Confirm/ })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    await userEvent.click(within(c).getByRole("button", { name: "Details" }));
    expect(screen.getByRole("dialog", { name: "Protection details" })).toHaveTextContent("Problem");
  });

  it("a change signed by a device this one doesn't know says so, with Review devices first", async () => {
    read.mockResolvedValue(report({ state: "provisional", stopped: "untrusted_signer", signer: null }));
    const review = vi.fn();
    render(<ProtectionSettings onReviewDevices={review} />);
    const c = await card();
    expect(await within(c).findByText("The latest change is signed by a device this device doesn’t know. This device keeps the setting it last confirmed.")).toBeInTheDocument();
    await userEvent.click(within(c).getByRole("button", { name: "Review devices" }));
    expect(review).toHaveBeenCalledOnce();
  });
});
