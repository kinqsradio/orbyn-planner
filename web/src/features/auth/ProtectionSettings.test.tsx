import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
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
    const details = screen.getByRole("dialog", { name: "Protection details" });
    expect(details).toHaveTextContent("For you or Orbyn support. Nothing here is secret.");
    expect(details).toHaveTextContent("ReasonThe server showed an older setting");
    expect(details).not.toHaveTextContent("Devices that confirmed");
    expect(details).toHaveTextContent("Newest setting on the serverStandard · change 1");
    expect(details).toHaveTextContent("Signed byMacBook Air · 3 Nov");
    expect(details).toHaveTextContent("Last confirmed on this browserStandard · change 1 · 3 Nov");
    expect(within(details).getByRole("button", { name: "Copy details" })).toBeInTheDocument();
    await userEvent.click(within(details).getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("a change signed by a device this one doesn't know says so, with Review devices first", async () => {
    read.mockResolvedValue(report({ state: "provisional", stopped: "untrusted_signer", signer: null }));
    const review = vi.fn();
    render(<ProtectionSettings onReviewDevices={review} />);
    const c = await card();
    expect(await within(c).findByText("The latest change is signed by a device this browser doesn’t know. This browser keeps the setting it last confirmed.")).toBeInTheDocument();
    await userEvent.click(within(c).getByRole("button", { name: "Review devices" }));
    expect(review).toHaveBeenCalledOnce();
  });
});

describe("the other cards", () => {
  it.each([
    ["invalid_signature", "The latest change has a signature that doesn’t check out. This browser keeps the setting it last confirmed."],
    ["gap", "Some changes are missing between the setting this browser confirmed and the newest one. This browser keeps the setting it last confirmed."],
    ["invalid", "One of the changes isn’t in a form this browser can read. This browser keeps the setting it last confirmed."],
  ] as const)("a stopped chain (%s) uses the Can’t confirm card with its own line, the laptop line and Details", async (stopped, line) => {
    read.mockResolvedValue(report({ state: "provisional", stopped }));
    render(<ProtectionSettings />);
    const c = await card();
    expect(await within(c).findByText(line)).toBeInTheDocument();
    expect(c).toHaveTextContent("Open Orbyn on a trusted device to fix this.");
    expect(within(c).getByRole("button", { name: "Details" })).toBeInTheDocument();
  });

  it("with no date known on this browser the title says so, and the verified card says Orbyn can read Standard data", async () => {
    read.mockResolvedValue(report({ problem: "fork", state: "provisional" }));
    render(<ProtectionSettings />);
    expect(await within(await card()).findByText("Standard protection, last confirmed on this browser")).toBeInTheDocument();
    cleanup();
    read.mockResolvedValue(report({}));
    render(<ProtectionSettings />);
    expect(await card()).toHaveTextContent("With Standard, Orbyn keeps a recovery copy of your keys, so it can read your data. Advanced protection, planned, removes that copy.");
  });
});

describe("loading, errors and busy buttons", () => {
  it("shows nothing for 400 ms, then a spinner and skeleton lines", async () => {
    vi.useFakeTimers();
    try {
      read.mockReturnValue(new Promise(() => undefined));
      render(<ProtectionSettings />);
      await act(async () => void (await vi.advanceTimersByTimeAsync(399)));
      expect(screen.queryByText("Checking protection…")).toBeNull();
      await act(async () => void (await vi.advanceTimersByTimeAsync(2)));
      expect(screen.getByText("Checking protection…")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("an unanswered read says so, keeps the last setting, and Try again reads again", async () => {
    read.mockRejectedValueOnce(new Error("down"));
    read.mockResolvedValue(report({}));
    render(<ProtectionSettings />);
    const c = await card();
    expect(await within(c).findByText("Couldn’t check protection")).toBeInTheDocument();
    expect(c).toHaveTextContent("Orbyn didn’t answer. This device keeps the setting it last confirmed.");
    await userEvent.click(within(c).getByRole("button", { name: "Try again" }));
    expect(await within(await card()).findByText("Standard protection")).toBeInTheDocument();
  });

  it("a failed Confirm says so under the buttons; the button shows Confirming… while it works and keeps its width", async () => {
    read.mockResolvedValue(report({ state: "provisional", seq: 0 }));
    let fail: (e: Error) => void = () => undefined;
    confirm.mockReturnValue(new Promise((_, reject) => (fail = reject)));
    render(<ProtectionSettings />);
    const dialog = await screen.findByRole("dialog", { name: "Confirm your protection level" });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await userEvent.click(within(dialog).getByRole("button", { name: "Confirm" }));
    expect(within(dialog).getByRole("button", { name: "Confirm" })).toBeDisabled(); // disabled at once, and it still looks idle
    await act(async () => void (await vi.advanceTimersByTimeAsync(450)));
    vi.useRealTimers();
    const busy = within(dialog).getByRole("button", { name: "Confirming…" });
    expect(busy).toBeDisabled();
    expect(busy.querySelector(".spin")).not.toBeNull();
    await act(async () => fail(new Error("offline")));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Couldn’t confirm. Check your connection and try again.");
    expect(within(dialog).getByRole("button", { name: "Confirm" })).toBeEnabled();
  });

  it("Not set: the dialog says Confirming sets Standard, has no Set on row, and the button reads Set Standard protection", async () => {
    read.mockResolvedValue(report({ state: "unknown", seq: 0, level: null, head: null, signer: null }));
    render(<ProtectionSettings />);
    await userEvent.click(await within(await card()).findByRole("button", { name: "Choose" }));
    const dialog = screen.getByRole("dialog", { name: "Confirm your protection level" });
    expect(dialog).toHaveTextContent("No device has set a protection level for this account yet. Confirming sets Standard protection.");
    expect(within(dialog).queryByText("Set on")).toBeNull();
    expect(within(dialog).getByRole("button", { name: "Set Standard protection" })).toBeInTheDocument();
  });
});
