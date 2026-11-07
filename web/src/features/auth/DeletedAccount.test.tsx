import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useSyncExternalStore } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiFailure } from "../../api/auth";
import { accountCheck, askWhetherDeleted, deletedAccount, type DeletedAccount } from "../../auth/deletedAccount";
import type { AuthServices } from "../../auth/services";
import { CheckingAccount, DeletedAccountScreen, fileSize } from "./DeletedAccount";

const removePlanner = vi.fn();
const closePlanner = vi.fn();
const save = vi.fn();
const clearDevice = vi.fn();
const loadIdentity = vi.fn();
const forgetNotice = vi.fn();
const forgetAnswer = vi.fn();
const exists = vi.fn();
vi.mock("../../store/planners", () => ({
  accountPlannerExists: () => exists(),
  plannerFor: () => ({ ready: Promise.resolve(), getState: () => ({ tasks: [], lists: [], projects: [], calendars: [], events: [], tags: [], outbox: [] }) }),
  removeAccountPlanner: (...a: unknown[]) => removePlanner(...a),
  closePlanner: (...a: unknown[]) => closePlanner(...a),
}));
vi.mock("../../auth/protectionNotice", () => ({ forgetProtectionNotice: (...a: unknown[]) => forgetNotice(...a) }));
vi.mock("../../store/deviceData", () => ({ forgetDeviceDataAnswer: (...a: unknown[]) => forgetAnswer(...a) }));
vi.mock("../export/save", () => ({ saveFile: (...a: unknown[]) => save(...a) }));
vi.mock("../export/exportJson", () => ({ exportJson: () => "x".repeat(2400) }));

const services = {
  engine: { exclusive: <T,>(fn: () => Promise<T>) => fn() },
  keys: { loadIdentity: () => loadIdentity(), clearDevice: () => clearDevice() },
} as unknown as AuthServices;
const base: DeletedAccount = { accountId: "acct-1", email: "sam@example.com", deletedAt: "2026-11-14T00:00:00Z", phase: "choose", hadCopy: true, file: null };
const onLeave = vi.fn();

function Harness({ using = services }: { using?: AuthServices }) {
  const account = useSyncExternalStore(deletedAccount.subscribe, deletedAccount.get);
  return account ? <DeletedAccountScreen account={account} services={using} onLeave={onLeave} /> : <p>gone</p>;
}
const show = (over: Partial<DeletedAccount> = {}) => {
  deletedAccount.set({ ...base, ...over });
  return render(<Harness />);
};

beforeEach(() => {
  removePlanner.mockReset().mockResolvedValue(undefined);
  closePlanner.mockReset();
  save.mockReset().mockResolvedValue(true);
  clearDevice.mockReset().mockResolvedValue(undefined);
  loadIdentity.mockReset().mockResolvedValue({ accountId: "acct-1", deviceId: "d1", email: "sam@example.com" });
  forgetNotice.mockReset();
  forgetAnswer.mockReset();
  exists.mockReset().mockResolvedValue(true);
  onLeave.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
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
    expect(clearDevice).not.toHaveBeenCalled();
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

  it("while it exports, Export shows a spinner and Exporting… after 400 ms and Remove it now is disabled", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    save.mockReturnValue(new Promise(() => undefined));
    show();
    await userEvent.click(screen.getByRole("button", { name: "Export what’s on this browser" }));
    expect(screen.getByRole("button", { name: "Remove it now" })).toBeDisabled(); // at once
    expect(screen.getByRole("button", { name: "Export what’s on this browser" })).toBeDisabled();
    await act(async () => void (await vi.advanceTimersByTimeAsync(450)));
    const busy = screen.getByRole("button", { name: "Exporting…" });
    expect(busy.querySelector(".spin")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Remove it now" })).toBeDisabled();
  });

  it("while it removes after an export, Remove it now shows Removing… and Export again is disabled; later the removal screen takes over", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    removePlanner.mockReturnValue(new Promise(() => undefined));
    show({ phase: "exported", file: { name: "orbyn-planner-2026-11-07.json", size: 84_000 } });
    expect(screen.getByText("Downloaded orbyn-planner-2026-11-07.json · 84 kB")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Remove it now" }));
    expect(screen.getByRole("button", { name: "Export again" })).toBeDisabled();
    await act(async () => void (await vi.advanceTimersByTimeAsync(450)));
    const busy = screen.getByRole("button", { name: "Removing…" });
    expect(busy.querySelector(".spin")).not.toBeNull();
    expect(busy).toBeDisabled();
    expect(screen.getByRole("button", { name: "Export again" })).toBeDisabled();
    await act(async () => void (await vi.advanceTimersByTimeAsync(500)));
    expect(screen.getByRole("status")).toHaveTextContent("Removing its copy from this browser");
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
    expect(clearDevice).toHaveBeenCalledTimes(1);
    expect(forgetNotice).toHaveBeenCalledWith("acct-1"); // everything this browser kept for the account goes with it
    expect(forgetAnswer).toHaveBeenCalledWith("acct-1");
    expect(within(card).getAllByRole("button").map((b) => b.textContent)).toEqual(["Create a new account", "Sign in with another account"]);
  });

  it("while it removes, the screen says so and nothing else is offered", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    removePlanner.mockReturnValue(new Promise(() => undefined));
    show();
    await userEvent.click(screen.getByRole("button", { name: "Remove it now" }));
    await act(async () => void (await vi.advanceTimersByTimeAsync(900)));
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

  it("keeps another account's keys: if the device was signed in to a different account meanwhile, Remove does not clear it", async () => {
    loadIdentity.mockResolvedValue({ accountId: "acct-B", deviceId: "d2", email: "alex@example.com" });
    show();
    await userEvent.click(screen.getByRole("button", { name: "Remove it now" }));
    expect(await screen.findByText("Orbyn removed its copy from this browser.")).toBeInTheDocument();
    expect(removePlanner).toHaveBeenCalledWith("acct-1"); // this account's planner goes
    expect(clearDevice).not.toHaveBeenCalled(); // B's keys stay
  });

  it("if another tab already removed the copy, Export does not make an empty one: it ends on the nothing-to-remove screen", async () => {
    exists.mockResolvedValue(false);
    show();
    await userEvent.click(screen.getByRole("button", { name: "Export what’s on this browser" }));
    expect(await screen.findByText("This browser had no copy to remove.")).toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
  });

  it("a failed key removal counts as a failed removal", async () => {
    clearDevice.mockRejectedValueOnce(new Error("keys"));
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

describe("Remove with the real key store", () => {
  it("clears this account's device keys, and leaves another account's alone", async () => {
    const { createMemoryKeyStore } = await import("../../api/keyStore");
    const { createAuthServices } = await import("../../auth/services");
    const run = async (identityOnDevice: string) => {
      const keys = createMemoryKeyStore();
      await keys.saveKeys(new Uint8Array([1, 2, 3]));
      await keys.saveIdentity({ accountId: identityOnDevice, deviceId: "d", email: "x@example.com" });
      const real = createAuthServices({ keys, wrapSecret: async () => new Uint8Array(32) });
      deletedAccount.set({ ...base });
      const view = render(<Harness using={real} />);
      await userEvent.click(screen.getByRole("button", { name: "Remove it now" }));
      await screen.findByText("Orbyn removed its copy from this browser.");
      view.unmount();
      return keys;
    };
    const own = await run("acct-1");
    expect(await own.loadKeys()).toBeNull(); // the deleted account's own keys are gone
    expect(await own.loadIdentity()).toBeNull();
    const other = await run("acct-B");
    expect(await other.loadKeys()).toEqual(new Uint8Array([1, 2, 3])); // B's device survives
    expect(await other.loadIdentity()).toMatchObject({ accountId: "acct-B" });
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

  it("anything that is not a date is read as not deleted", async () => {
    await askWhetherDeleted({ accountStatus: vi.fn().mockResolvedValue({ deleted_at: "someday" }) }, session, false);
    await askWhetherDeleted({ accountStatus: vi.fn().mockResolvedValue({ deleted_at: 5 }) }, session, false);
    expect(deletedAccount.get()).toBeNull();
  });

  it("after an unreachable check the next 401 asks again", async () => {
    const api = { accountStatus: vi.fn().mockRejectedValueOnce(new TypeError("offline")).mockResolvedValueOnce({ deleted_at: "2026-11-14T00:00:00Z" }) };
    await askWhetherDeleted(api, session, false);
    expect(deletedAccount.get()).toBeNull();
    await askWhetherDeleted(api, session, false);
    expect(api.accountStatus).toHaveBeenCalledTimes(2);
    expect(deletedAccount.get()).toMatchObject({ phase: "choose" });
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

describe("the check after a 401", () => {
  it("holds nothing on screen for 400 ms, then a neutral card with a still spinner and no buttons", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<CheckingAccount />);
    expect(screen.queryByRole("status")).toBeNull();
    await act(async () => void (await vi.advanceTimersByTimeAsync(450)));
    const card = screen.getByRole("status");
    expect(card).toHaveTextContent("Checking your account…");
    expect(card).toHaveTextContent("This takes a moment.");
    expect(card.querySelector(".spin.still")).not.toBeNull();
    expect(within(card).queryAllByRole("button")).toHaveLength(0);
  });

  it("is on while the status request is in flight and off when it answers", async () => {
    let answer: (v: null) => void = () => undefined;
    const api = { accountStatus: vi.fn(() => new Promise<null>((r) => (answer = r))) };
    const pending = askWhetherDeleted(api, { accountId: "acct-1", email: "sam@example.com" }, false);
    expect(accountCheck.get()).toBe(true);
    answer(null);
    await pending;
    expect(accountCheck.get()).toBe(false);
  });
});

describe("the file size", () => {
  it("is written in kB and MB, one decimal", () => {
    expect(fileSize(512)).toBe("512 B");
    expect(fileSize(2400)).toBe("2.4 kB");
    expect(fileSize(84_000)).toBe("84 kB");
    expect(fileSize(2_400_000)).toBe("2.4 MB");
  });
});
