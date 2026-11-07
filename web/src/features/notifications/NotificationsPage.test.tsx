import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { takeSettingsTarget } from "../../app/settingsTarget";
import type { ProtectionReport } from "../../auth/flows";
import type { Task } from "../../store/types";
import { NotificationsPage } from "./NotificationsPage";
import { NotificationsProvider, dueWords, useNotifications } from "./useNotifications";

const read = vi.fn<() => Promise<ProtectionReport>>();
const navigate = vi.fn();
const openTask = vi.fn();
let tasks: Task[] = [];
const NOW = new Date(2026, 10, 7, 12, 30);
vi.mock("../../auth/flows", () => ({ readProtection: () => read() }));
vi.mock("../../app/router", () => ({ useRouter: () => ({ path: "/notifications", navigate }) }));
vi.mock("../../app/ui", () => ({ useUi: () => ({ openTask }) }));
vi.mock("../../app/clock", () => ({ useNow: () => NOW }));
vi.mock("../../store/context", () => ({ usePlanner: () => ({ tasks }) }));
const auth = vi.hoisted(() => ({ services: {}, session: { accountId: "acct-1", deviceState: "trusted", deviceId: "d1" } as { accountId: string; deviceState: string; deviceId: string } }));
vi.mock("../../auth/AuthProvider", () => ({ useAuth: () => auth }));

const at = Math.floor(new Date(2026, 10, 7, 9, 41).getTime() / 1000);
const changed: ProtectionReport = {
  seq: 2, state: "verified", level: "standard", stopped: null, problem: null,
  head: { level: "standard", seq: 2, prev: "p", signed_at: BigInt(at), signer_device_id: "d2", signature: "s" },
  signer: { id: "d2", name: "iPhone 16", thisDevice: false }, changedBy: { id: "d2", name: "iPhone 16" },
};
const task = (over: Partial<Task>): Task => ({
  id: "t1", title: "Send the launch brief to Priya", notes: "", listId: "l", due: "2026-11-07T12:00", priority: "none", done: false, completedAt: null, deletedAt: null,
  checklist: [], tags: [], projectId: null, sectionId: null, repeat: null, reminder: 0, completions: [], overrideOf: null, createdAt: "", updatedAt: "", ...over,
});
function Count() {
  return <span data-testid="count">{useNotifications().unread}</span>;
}
const ui = () => render(<NotificationsProvider><Count /><NotificationsPage /></NotificationsProvider>);

beforeEach(() => {
  localStorage.clear();
  read.mockReset();
  read.mockResolvedValue({ ...changed, changedBy: null });
  navigate.mockReset();
  openTask.mockReset();
  tasks = [];
});
afterEach(cleanup);

describe("Notifications", () => {
  it("is calm when there is nothing, with a way to the notification settings", async () => {
    ui();
    expect(await screen.findByText("You’re all caught up")).toBeInTheDocument();
    expect(screen.getByText("Reminders and changes to shared lists appear here.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Notification settings" }));
    expect(navigate).toHaveBeenCalledWith("/settings");
    expect(takeSettingsTarget()).toBe("Notifications");
  });

  it("lists a reminder that has come due as unread, opens its task, and marks all as read", async () => {
    tasks = [task({})];
    ui();
    expect(await screen.findByText("Send the launch brief to Priya is due at 12:00")).toBeInTheDocument();
    expect(screen.getByText("1 unread")).toBeInTheDocument();
    expect(screen.getByTestId("count")).toHaveTextContent("1");
    await userEvent.click(screen.getByRole("button", { name: "Mark all as read" }));
    expect(screen.getByText("All caught up")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mark all as read" })).toBeDisabled(); // nothing left to mark
    expect(screen.getByTestId("count")).toHaveTextContent("0");
    await userEvent.click(screen.getByRole("button", { name: "Open task" }));
    expect(openTask).toHaveBeenCalledWith("t1");
  });

  it("words a due date: a time only for a timed task due today, a day for the others, and 'was due' once late", () => {
    const now = new Date(2026, 10, 7, 12, 30); // Saturday 7 November
    expect(dueWords("Pay rent", "2026-11-07", now)).toBe("Pay rent is due today");
    expect(dueWords("Pay rent", "2026-11-08", now)).toBe("Pay rent is due tomorrow");
    expect(dueWords("Pay rent", "2026-11-09", now)).toBe("Pay rent is due Monday 9 November");
    expect(dueWords("Pay rent", "2026-11-06", now)).toBe("Pay rent was due yesterday");
    expect(dueWords("Pay rent", "2026-11-04", now)).toBe("Pay rent was due Wednesday 4 November");
    expect(dueWords("Send it", "2026-11-07T12:00", now)).toBe("Send it is due at 12:00");
    expect(dueWords("Send it", "2026-11-06T18:00", now)).toBe("Send it was due yesterday"); // a date alone: no time once late
  });

  it("an all-day reminder shows no time", async () => {
    tasks = [task({ id: "t2", title: "Pay rent", due: "2026-11-07" })];
    ui();
    expect(await screen.findByText("Pay rent is due today")).toBeInTheDocument();
  });

  it("what was read is kept for each account: marking one account's reminders read leaves another's unread", async () => {
    tasks = [task({})];
    auth.session = { accountId: "acct-1", deviceState: "trusted", deviceId: "d1" };
    ui();
    await userEvent.click(await screen.findByRole("button", { name: "Mark all as read" }));
    expect(screen.getByTestId("count")).toHaveTextContent("0");
    cleanup();
    auth.session = { accountId: "acct-2", deviceState: "trusted", deviceId: "d9" };
    ui();
    expect(await screen.findByText("1 unread")).toBeInTheDocument(); // another account's marks do not reach this one
    auth.session = { accountId: "acct-1", deviceState: "trusted", deviceId: "d1" };
  });

  it("a reminder that has not come due is not listed", async () => {
    tasks = [task({ due: "2026-11-07T15:00" })];
    ui();
    expect(await screen.findByText("You’re all caught up")).toBeInTheDocument();
  });

  it("shows a protection change another device made, with its time and an unread dot; selecting it opens Privacy in Settings", async () => {
    read.mockResolvedValue(changed);
    ui();
    const row = await screen.findByText(/Protection was changed to Standard on iPhone 16/);
    const item = row.closest("li")!;
    expect(item).toHaveTextContent("Opens Data protection in your account");
    expect(item).toHaveTextContent("09:41");
    expect(within(item).getByLabelText("Unread")).toBeInTheDocument();
    await userEvent.click(row);
    expect(navigate).toHaveBeenCalledWith("/settings");
    expect(takeSettingsTarget()).toBe("Privacy");
    expect(within(item).queryByLabelText("Unread")).toBeNull();
  });
});
