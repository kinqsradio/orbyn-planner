import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useSyncExternalStore } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiFailure } from "../../api/auth";
import { askWhetherDeleted, deletedAccount, type DeletedAccount } from "../../auth/deletedAccount";
import type { AuthServices } from "../../auth/services";
import { DeletedAccountScreen, fileSize } from "./DeletedAccount";

const removePlanner = vi.fn();
const closePlanner = vi.fn();
const save = vi.fn();
const forget = vi.fn();
vi.mock("../../store/planners", () => ({
  plannerFor: () => ({ ready: Promise.resolve(), getState: () => ({ tasks: [], lists: [], projects: [], calendars: [], events: [], tags: [], outbox: [] }) }),
  removeAccountPlanner: (...a: unknown[]) => removePlanner(...a),
  closePlanner: (...a: unknown[]) => closePlanner(...a),
}));
vi.mock("../export/save", () => ({ saveFile: (...a: unknown[]) => save(...a) }));
vi.mock("../export/exportJson", () => ({ exportJson: () => "x".repeat(2400) }));

const services = { engine: { forget: () => forget() } } as unknown as AuthServices;
const base: DeletedAccount = { accountId: "acct-1", email: "sam@example.com", deletedAt: "2026-11-14T00:00:00Z", phase: "choose", hadCopy: true, file: null };
const onLeave = vi.fn();

function Harness() {
  const account = useSyncExternalStore(deletedAccount.subscribe, deletedAccount.get);
  return account ? <DeletedAccountScreen account={account} services={services} onLeave={onLeave} /> : <p>gone</p>;
}
const show = (over: Partial<DeletedAccount> = {}) => {
  deletedAccount.set({ ...base, ...over });
  return render(<Harness />);
};

beforeEach(() => {
  removePlanner.mockReset().mockResolvedValue(undefined);
  closePlanner.mockReset();
  save.mockReset().mockResolvedValue(true);
  forget.mockReset().mockResolvedValue(undefined);
  onLeave.mockReset();
});
afterEach(() => {
  cleanup();
  deletedAccount.set(null);
});

describe("the account was deleted: choose, export, remove", () => {
  it("says it plainly, offers Export and Remove it now, and removes nothing until chosen", () => {
    show();
    const card = screen.getByRole("group", { name: "This account was deleted" });
    expect(card).toHaveTextContent("sam@example.com was deleted on Saturday 14 November. Its data on Orbyn’s servers is gone and can’t be restored.");
    expect(card).toHaveTextContent("A copy is still on this browser, and it’s the only one left. Export it first if you want to keep anything. Nothing else opens until you choose.");
    expect(within(card).getAllByRole("button").map((b) => b.textContent)).toEqual(["Export what’s on this browser", "Remove it now"]);
    expect(card).toHaveTextContent("Removing it deletes this browser’s copy for good.");
    expect(removePlanner).not.toHaveBeenCalled();
    expect(forget).not.toHaveBeenCalled();
  });

  it("the date is the UTC day, so a late evening elsewhere does not move it", () => {
    show({ deletedAt: "2026-11-14T00:00:00Z" });
    expect(screen.getByText(/was deleted on Saturday 14 November/)).toBeInTheDocument();
    cleanup();
    show({ deletedAt: "2026-11-14T23:59:00Z" });
    expect(screen.getByText(/was deleted on Saturday 14 November/)).toBeInTheDocument();
  });

  it("Export saves the file, names it and its size, and keeps the copy: Remove it now becomes the main button", async () => {
    show();
    await userEvent.click(screen.getByRole("button", { name: "Export what’s on this browser" }));
    expect(save).toHaveBeenCalledWith(expect.stringMatching(/^orbyn-planner-\d{4}-\d{2}-\d{2}\.json$/), "application/json", "x".repeat(2400));
    const card = await screen.findByRole("group", { name: "This account was deleted" });
    expect(card).toHaveTextContent(/Downloaded orbyn-planner-\d{4}-\d{2}-\d{2}\.json · 2\.4 kB/);
    expect(card).toHaveTextContent("The copy on this browser is still here until you remove it.");
    expect(within(card).getByRole("button", { name: "Remove it now" })).toHaveClass("btn");
    expect(within(card).getByRole("button", { name: "Export again" })).toHaveClass("ghost");
    expect(removePlanner).not.toHaveBeenCalled(); // exporting removes nothing
  });

  it("closing the save dialog changes nothing", async () => {
    save.mockResolvedValue(false);
    show();
    await userEvent.click(screen.getByRole("button", { name: "Export what’s on this browser" }));
    expect(await screen.findByRole("button", { name: "Export what’s on this browser" })).toBeEnabled();
    expect(screen.queryByText(/Downloaded/)).toBeNull();
  });

  it("a failed export says nothing was removed, offers Try again and Remove it anyway, and removes nothing", async () => {
    save.mockRejectedValueOnce(new Error("disk"));
    show();
    await userEvent.click(screen.getByRole("button", { name: "Export what’s on this browser" }));
    const card = await screen.findByRole("group", { name: "This account was deleted" });
    expect(await within(card).findByRole("alert")).toHaveTextContent("Couldn’t export your data. Nothing was removed from this browser.");
    expect(card).toHaveTextContent("The copy on this browser is the only one left.");
    expect(within(card).getByRole("button", { name: "Try again" })).toHaveClass("btn");
    expect(within(card).getByRole("button", { name: "Remove it anyway" })).toHaveClass("red");
    expect(removePlanner).not.toHaveBeenCalled();
    await userEvent.click(within(card).getByRole("button", { name: "Try again" }));
    expect(await screen.findByText(/Downloaded orbyn-planner-/)).toBeInTheDocument();
  });

  it("Remove it now removes this account's planner and the device's keys, with no second question, then says it did", async () => {
    show();
    await userEvent.click(screen.getByRole("button", { name: "Remove it now" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    const card = await screen.findByRole("group", { name: "This account was deleted" });
    expect(await within(card).findByText("Orbyn removed its copy from this browser.")).toBeInTheDocument();
    expect(card).toHaveTextContent("sam@example.com was deleted on Saturday 14 November, after its 7 days ended. Its data can’t be restored.");
    expect(removePlanner).toHaveBeenCalledWith("acct-1");
    expect(forget).toHaveBeenCalledTimes(1);
    expect(within(card).getAllByRole("button").map((b) => b.textContent)).toEqual(["Create a new account", "Sign in with another account"]);
  });

  it("while it removes, the screen says so and nothing else is offered", async () => {
    removePlanner.mockReturnValue(new Promise(() => undefined));
    show();
    await userEvent.click(screen.getByRole("button", { name: "Remove it now" }));
    const card = await screen.findByRole("group", { name: "This account was deleted" });
    expect(card).toHaveTextContent("sam@example.com was deleted on Saturday 14 November. Its data can’t be restored.");
    expect(within(card).getByRole("status")).toHaveTextContent("Removing its copy from this browser");
    expect(card).toHaveTextContent("This takes a moment. Nothing else opens until it’s done.");
    expect(within(card).queryAllByRole("button")).toHaveLength(0);
  });

  it("a removal that fails says so, points to the browser's settings, and Try again goes again", async () => {
    removePlanner.mockRejectedValueOnce(new Error("blocked"));
    show();
    await userEvent.click(screen.getByRole("button", { name: "Remove it now" }));
    const card = await screen.findByRole("group", { name: "This account was deleted" });
    expect(await within(card).findByRole("alert")).toHaveTextContent("Couldn’t remove this browser’s copy. Try again, or clear this site’s data in your browser settings.");
    expect(within(card).getAllByRole("button").map((b) => b.textContent)).toEqual(["Try again"]);
    await userEvent.click(within(card).getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Orbyn removed its copy from this browser.")).toBeInTheDocument();
    expect(removePlanner).toHaveBeenCalledTimes(2);
  });

  it("a failed key removal counts as a failed removal", async () => {
    forget.mockRejectedValueOnce(new Error("keys"));
    show();
    await userEvent.click(screen.getByRole("button", { name: "Remove it now" }));
    expect(await screen.findByText(/Couldn’t remove this browser’s copy/)).toBeInTheDocument();
  });

  it("with nothing held on this browser it says so, and the buttons go to sign-up and sign-in", async () => {
    show({ phase: "final", hadCopy: false });
    const card = screen.getByRole("group", { name: "This account was deleted" });
    expect(card).toHaveTextContent("sam@example.com was deleted on Saturday 14 November. Its data on Orbyn’s servers is gone and can’t be restored.");
    expect(card).toHaveTextContent("This browser had no copy to remove.");
    expect(removePlanner).not.toHaveBeenCalled();
    await userEvent.click(within(card).getByRole("button", { name: "Create a new account" }));
    expect(onLeave).toHaveBeenCalledWith("signup");
    await userEvent.click(within(card).getByRole("button", { name: "Sign in with another account" }));
    expect(onLeave).toHaveBeenLastCalledWith("signin");
  });
});

describe("asking whether the account was deleted", () => {
  const session = { accountId: "acct-1", email: "sam@example.com" };

  it("a 200 shows the screen, with the UTC day and the choose phase", async () => {
    const api = { accountStatus: vi.fn().mockResolvedValue({ deleted_at: "2026-11-14T00:00:00Z" }) };
    await askWhetherDeleted(api, session, false);
    expect(api.accountStatus).toHaveBeenCalledWith("acct-1");
    expect(deletedAccount.get()).toMatchObject({ phase: "choose", hadCopy: true, deletedAt: "2026-11-14T00:00:00Z" });
  });

  it("a browser with its keys in memory only goes straight to the last screen", async () => {
    await askWhetherDeleted({ accountStatus: vi.fn().mockResolvedValue({ deleted_at: "2026-11-14T00:00:00Z" }) }, session, true);
    expect(deletedAccount.get()).toMatchObject({ phase: "final", hadCopy: false });
  });

  it("a 404, a refusal and an unreachable engine all show nothing", async () => {
    await askWhetherDeleted({ accountStatus: vi.fn().mockResolvedValue(null) }, session, false);
    await askWhetherDeleted({ accountStatus: vi.fn().mockRejectedValue(new ApiFailure("too_many_attempts", 429, "Too many.")) }, session, false);
    await askWhetherDeleted({ accountStatus: vi.fn().mockRejectedValue(new TypeError("offline")) }, session, false);
    expect(deletedAccount.get()).toBeNull();
  });

  it("two 401s at once ask once", async () => {
    let answer: (v: null) => void = () => undefined;
    const api = { accountStatus: vi.fn(() => new Promise<null>((r) => (answer = r))) };
    const first = askWhetherDeleted(api, session, false);
    void askWhetherDeleted(api, session, false);
    answer(null);
    await first;
    expect(api.accountStatus).toHaveBeenCalledTimes(1);
  });
});

describe("the file size", () => {
  it("is written in kB and MB, one decimal", () => {
    expect(fileSize(512)).toBe("512 B");
    expect(fileSize(2400)).toBe("2.4 kB");
    expect(fileSize(2_400_000)).toBe("2.4 MB");
  });
});
