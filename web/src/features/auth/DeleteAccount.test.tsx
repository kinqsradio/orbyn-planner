import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deletionNotice } from "../../auth/deletionNotice";
import { DeleteAccountRow } from "./DeleteAccount";
import { DeletionBanner } from "./DeletionBanner";

const schedule = vi.fn();
const cancel = vi.fn();
const openAuth = vi.fn();
const showToast = vi.fn();
const auth = vi.hoisted(() => ({
  current: null as unknown,
}));
vi.mock("../../auth/flows", () => ({ scheduleDeletion: (...a: unknown[]) => schedule(...a), cancelDeletion: (...a: unknown[]) => cancel(...a) }));
vi.mock("../../auth/AuthProvider", () => ({ useAuth: () => auth.current }));
vi.mock("../../app/ui", () => ({ useUi: () => ({ showToast }) }));
vi.mock("../../store/context", () => ({ usePlanner: () => ({ tasks: [], lists: [], projects: [], calendars: [] }) }));

const currentDevice = vi.fn();
const setAuth = (deviceState: "trusted" | "pending") => {
  auth.current = {
    services: { api: { currentDevice: () => currentDevice() } },
    session: { accountId: "a", deviceId: "d", deviceState, email: "sam@example.com", name: "Sam", token: "t", expiresAt: "2099-01-01T00:00:00Z" },
    overlay: null,
    openAuth,
  };
};

beforeEach(() => {
  schedule.mockReset();
  cancel.mockReset();
  openAuth.mockReset();
  showToast.mockReset();
  currentDevice.mockReset();
  currentDevice.mockResolvedValue({ totp_enabled: false, deletion_scheduled_at: null });
  deletionNotice.set(null);
  setAuth("trusted");
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  deletionNotice.set(undefined);
});

describe("the Delete account row and its dialog", () => {
  it("the row says what it does and opens the dialog", async () => {
    render(<DeleteAccountRow />);
    expect(screen.getByText("Delete account")).toBeInTheDocument();
    expect(screen.getByText("Deletes your Orbyn account and its data in every Orbyn app, after 7 days.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Delete account…" }));
    expect(await screen.findByRole("dialog", { name: "Delete your Orbyn account" })).toBeInTheDocument();
  });

  it("on a browser that isn't trusted, deletion can't start: it says where it can, and Approve this browser opens the approval screens", async () => {
    setAuth("pending");
    render(<DeleteAccountRow />);
    await userEvent.click(screen.getByRole("button", { name: "Delete account…" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("You can only delete your account from a trusted device. This browser isn’t one. Use the Orbyn app on your Mac or phone, or approve this browser from a trusted device first.");
    expect(within(dialog).queryByRole("button", { name: "Delete account" })).toBeNull();
    await userEvent.click(within(dialog).getByRole("button", { name: "Approve this browser" }));
    expect(openAuth).toHaveBeenCalledWith("cant");
  });

  it("if the engine can't say whether two-factor is on, no form is offered, only the error and Try again", async () => {
    currentDevice.mockRejectedValueOnce(new Error("offline"));
    render(<DeleteAccountRow />);
    await userEvent.click(screen.getByRole("button", { name: "Delete account…" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete your Orbyn account" });
    expect(await within(dialog).findByRole("alert")).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Delete account" })).toBeNull(); // never a dialog with no code field
    expect(within(dialog).queryByLabelText("Two-factor code")).toBeNull();
    await userEvent.click(within(dialog).getByRole("button", { name: "Try again" }));
    expect(await within(await screen.findByRole("dialog")).findByRole("button", { name: "Delete account" })).toBeEnabled();
  });

  it("a recovery code is complete only at ten letters or digits, with or without its dash", async () => {
    currentDevice.mockResolvedValue({ totp_enabled: true, deletion_scheduled_at: null });
    render(<DeleteAccountRow />);
    await userEvent.click(screen.getByRole("button", { name: "Delete account…" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(await within(dialog).findByRole("button", { name: "Use a recovery code" }));
    const field = within(dialog).getByLabelText("Recovery code");
    const confirm = within(dialog).getByRole("button", { name: "Delete account" });
    await userEvent.type(field, "abcde-fgh");
    expect(field).toHaveValue("ABCDE-FGH"); // capitals, the dash where the engine prints it
    expect(confirm).toBeDisabled();
    await userEvent.type(field, "jk");
    expect(field).toHaveValue("ABCDE-FGHJK");
    expect(confirm).toBeEnabled();
    await userEvent.clear(field);
    await userEvent.type(field, "abcdefghij");
    expect(field).toHaveValue("ABCDE-FGHIJ");
  });

  it("while it works the button reads Deleting… (after 400 ms), is disabled and keeps its place", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    schedule.mockReturnValue(new Promise(() => undefined));
    render(<DeleteAccountRow />);
    await userEvent.click(screen.getByRole("button", { name: "Delete account…" }));
    const dialog = await screen.findByRole("dialog");
    const confirm = await within(dialog).findByRole("button", { name: "Delete account" });
    await vi.waitFor(() => expect(confirm).toBeEnabled());
    await userEvent.click(confirm);
    expect(within(dialog).getByRole("button", { name: "Delete account" })).toBeDisabled(); // at once, still looking idle
    await act(async () => void (await vi.advanceTimersByTimeAsync(450)));
    const busy = within(dialog).getByRole("button", { name: "Deleting…" });
    expect(busy).toBeDisabled();
    expect(busy.querySelector(".spin")).not.toBeNull();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeDisabled();
  });
});

describe("the banner and the row while a deletion is scheduled", () => {
  it("the banner has only Cancel deletion, which reads Cancelling… while it works", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    deletionNotice.set(new Date(Date.now() + 5 * 86_400_000).toISOString());
    cancel.mockReturnValue(new Promise(() => undefined));
    render(<DeletionBanner />);
    const banner = screen.getByRole("status", { name: "Account deletion" });
    expect(within(banner).getAllByRole("button")).toHaveLength(1); // no "Sign in again", no extra controls
    await userEvent.click(within(banner).getByRole("button", { name: "Cancel deletion" }));
    await act(async () => void (await vi.advanceTimersByTimeAsync(450)));
    expect(within(banner).getByRole("button", { name: "Cancelling…" })).toBeDisabled();
  });

  it("the row becomes the date and says everything still works", () => {
    deletionNotice.set("2026-11-14T09:00:00.000Z");
    render(<DeleteAccountRow />);
    expect(screen.getByText(/^Deletion scheduled for \w+ 14 November$/)).toBeInTheDocument();
    expect(screen.getByText("Everything still works until then. Cancel any time.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel deletion" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete account…" })).toBeNull();
  });
});
