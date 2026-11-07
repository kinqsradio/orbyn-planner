import { render, renderHook, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StoreProvider } from "../../store/context";
import { LocalStore } from "../../store/LocalStore";
import { MemoryPersistence } from "../../store/persistence";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { SyncState } from "../../sync/controller";
import { SyncProviderForTests } from "../../sync/testing/SyncProviderForTests";
import { StrandedZones } from "./StrandedZones";
import { OnlyDeviceNote } from "../auth/AccountSettings";
import { SyncSettings } from "../settings/SyncSettings";
import { useSyncStatus } from "./SyncLine";

const base: SyncState = { phase: "idle", devices: 2, lastSyncedAt: "2026-11-07T10:00:00Z", quarantined: 0, waitingForKeys: [], stranded: [], needsApproval: false, keysPending: [], dropped: [], trashedEdits: [], failed: [], skipped: [], error: null, leader: true, live: true };

describe("the sync line follows real sync when it runs", () => {
  const status = (sync: SyncState | null, pending = 0) => renderHook(() => useSyncStatus(pending, sync)).result.current.status;

  it("synced with the device count, syncing, offline with the changes waiting, and an error", () => {
    expect(status(base)).toEqual({ kind: "synced", devices: 2 });
    expect(status({ ...base, phase: "syncing" })).toEqual({ kind: "syncing" });
    expect(status({ ...base, lastSyncedAt: null })).toEqual({ kind: "syncing" }); // not synced yet
    expect(status({ ...base, phase: "offline" }, 3)).toEqual({ kind: "offline", waiting: 3, lastSynced: "2026-11-07T10:00:00Z" });
    expect(status({ ...base, phase: "error", error: "x" })).toEqual({ kind: "error" });
  });

  it("without sync it is the health check's, as before", () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("down"))));
    expect(status(null).kind).toBe("syncing");
    vi.unstubAllGlobals();
  });
});

describe("Settings shows sync", () => {
  it("says what is synced, lists what can't be opened yet, and syncs on request", async () => {
    const syncNow = vi.fn();
    render(
      <WithStore><SyncProviderForTests state={{ ...base, quarantined: 2, waitingForKeys: ["list:x"] }} syncNow={syncNow}>
        <SyncSettings />
      </SyncProviderForTests></WithStore>,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Synced · 2 devices");
    expect(screen.getByText(/2 items from your other devices can’t be opened on this one yet/)).toBeInTheDocument();
    expect(screen.getByText(/1 list or calendar here is waiting for a key/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Sync now" }));
    expect(syncNow).toHaveBeenCalled();
  });

  it("shows nothing when this device isn't syncing", () => {
    const { container } = render(
      <WithStore><SyncProviderForTests state={null}>
        <SyncSettings />
      </SyncProviderForTests></WithStore>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

const plannerStore = new LocalStore({ persistence: new MemoryPersistence(), broadcast: false });
const WithStore = ({ children }: { children: ReactNode }) => <StoreProvider store={plannerStore}>{children}</StoreProvider>;

describe("a record deleted elsewhere while it had unsent changes", () => {
  it("says so in Settings, with the title, and where the changes are kept", () => {
    render(
      <WithStore>
        <SyncProviderForTests state={{ ...base, trashedEdits: ["Buy milk"] }}>
          <SyncSettings />
        </SyncProviderForTests>
      </WithStore>,
    );
    expect(screen.getByText("“Buy milk” was deleted on another device. Your unsent changes are in Recently deleted for 30 days.")).toBeInTheDocument();
  });
});

describe("a zone no device can open", () => {
  const stranded = { ...base, devices: 1, waitingForKeys: ["list:trip"], stranded: ["list:trip"] };

  it("is said plainly in Settings and can be removed for the account, and isn't also called merely waiting", async () => {
    const removeStranded = vi.fn(async () => undefined);
    render(
      <WithStore><SyncProviderForTests state={stranded} removeStranded={removeStranded}>
        <SyncSettings />
      </SyncProviderForTests></WithStore>,
    );
    expect(screen.getByText("This list can’t be opened on any of your devices.")).toBeInTheDocument();
    expect(screen.queryByText(/waiting for a key from another of your devices/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Remove it" }));
    expect(removeStranded).not.toHaveBeenCalled(); // asks first
    const ask = screen.getByRole("dialog", { name: "Delete on every device" });
    expect(ask).toHaveTextContent("Delete “this list” on every device? This can’t be undone.");
    expect(ask).toHaveTextContent("Only do this if no other device of yours is signed in.");
    await userEvent.click(within(ask).getByRole("button", { name: "Cancel" }));
    expect(removeStranded).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Remove it" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));
    expect(removeStranded).toHaveBeenCalledWith("list:trip");
  });

  it("a device that must be approved again says so, once, and nothing is called stranded or waiting", () => {
    render(
      <WithStore><SyncProviderForTests state={{ ...stranded, needsApproval: true, waitingForKeys: [], stranded: [] }}>
        <SyncSettings />
      </SyncProviderForTests></WithStore>,
    );
    expect(screen.getAllByText("This device needs to be approved again to open your lists. Approve it from another of your devices.")).toHaveLength(1);
    expect(screen.queryByText(/can’t be opened on any of your devices/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove it" })).toBeNull();
  });

  it("shows on the lists page for lists only", () => {
    render(
      <WithStore><SyncProviderForTests state={{ ...stranded, stranded: ["list:trip", "calendar:work"] }}>
        <StrandedZones only="list" />
      </SyncProviderForTests></WithStore>,
    );
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });

  it("sign-out warns on the only trusted device, and not when there are others", () => {
    const { unmount } = render(
      <WithStore><SyncProviderForTests state={stranded}>
        <OnlyDeviceNote />
      </SyncProviderForTests></WithStore>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("This is your only trusted device. Removing its planner here can’t be undone: lists only this device can open will be lost.");
    unmount();
    render(
      <WithStore><SyncProviderForTests state={base}>
        <OnlyDeviceNote />
      </SyncProviderForTests></WithStore>,
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
