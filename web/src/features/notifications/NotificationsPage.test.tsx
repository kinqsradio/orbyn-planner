import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { takeSettingsTarget } from "../../app/settingsTarget";
import type { ProtectionReport } from "../../auth/flows";
import { NotificationsPage } from "./NotificationsPage";

const read = vi.fn<() => Promise<ProtectionReport>>();
const navigate = vi.fn();
vi.mock("../../auth/flows", () => ({ readProtection: () => read() }));
vi.mock("../../app/router", () => ({ useRouter: () => ({ path: "/notifications", navigate }) }));
vi.mock("../../auth/AuthProvider", () => ({ useAuth: () => ({ services: {}, session: { accountId: "acct-1", deviceState: "trusted", deviceId: "d1" } }) }));

const at = Math.floor(new Date(2026, 10, 7, 9, 41).getTime() / 1000);
const changed: ProtectionReport = {
  seq: 2, state: "verified", level: "standard", stopped: null, problem: null,
  head: { level: "standard", seq: 2, prev: "p", signed_at: BigInt(at), signer_device_id: "d2", signature: "s" },
  signer: { id: "d2", name: "iPhone 16", thisDevice: false }, changedBy: { id: "d2", name: "iPhone 16" },
};

beforeEach(() => {
  localStorage.clear();
  read.mockReset();
  navigate.mockReset();
});
afterEach(cleanup);

describe("Notifications", () => {
  it("shows a protection change another device made, with its time and an unread dot; selecting it opens Privacy in Settings", async () => {
    read.mockResolvedValue(changed);
    render(<NotificationsPage />);
    const row = await screen.findByText(/Protection was changed to Standard on iPhone 16/);
    expect(row.closest("li")).toHaveTextContent("Opens Data protection in your account");
    expect(row.closest("li")).toHaveTextContent("09:41");
    expect(screen.getByLabelText("Unread")).toBeInTheDocument();
    expect(screen.getByText("1 new")).toBeInTheDocument();
    await userEvent.click(row);
    expect(navigate).toHaveBeenCalledWith("/settings");
    expect(takeSettingsTarget()).toBe("Privacy");
  });

  it("without a change there is nothing to show", async () => {
    read.mockResolvedValue({ ...changed, changedBy: null });
    render(<NotificationsPage />);
    expect(await screen.findByText("No notifications")).toBeInTheDocument();
  });
});
