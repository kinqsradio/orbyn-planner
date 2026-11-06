import { render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { SyncState } from "../../sync/controller";
import { SyncProviderForTests } from "../../sync/testing/SyncProviderForTests";
import { StrandedZones } from "./StrandedZones";
import { OnlyDeviceNote } from "../auth/AccountSettings";
import { SyncSettings } from "../settings/SyncSettings";
import { useSyncStatus } from "./SyncLine";

const base: SyncState = { phase: "idle", devices: 2, lastSyncedAt: "2026-11-07T10:00:00Z", quarantined: 0, waitingForKeys: [], stranded: [], keysPending: [], dropped: [], failed: [], skipped: [], error: null, leader: true, live: true };

describe("the sync line follows real sync when it runs", () => {
  const status = (sync: SyncState | null, pending = 0) => renderHook(() => useSyncStatus(pending, sync)).result.current.status;

  it("synced with the device count, syncing, offline with the changes waiting, and an error", () => {
    expect(status(base)).toEqual({ kind: "synced", devices: 2 });
    expect(status({ ...base, phase: "syncing" })).toEqual({ kind: "syncing" });
    expect(status({ ...base, lastSyncedAt: null })).toEqual({ kind: "syncing" }); // not synced yet
    expect(status({ ...base, phase: "offline" }, 3)).toEqual({ kind: "offline", waiting: 3 });
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
      <SyncProviderForTests state={{ ...base, quarantined: 2, waitingForKeys: ["list:x"] }} syncNow={syncNow}>
        <SyncSettings />
      </SyncProviderForTests>,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Synced · 2 devices");
    expect(screen.getByText(/2 items from your other devices can’t be opened on this one yet/)).toBeInTheDocument();
    expect(screen.getByText(/1 list or calendar here is waiting for a key/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Sync now" }));
    expect(syncNow).toHaveBeenCalled();
  });

  it("shows nothing when this device isn't syncing", () => {
    const { container } = render(
      <SyncProviderForTests state={null}>
        <SyncSettings />
      </SyncProviderForTests>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe("a zone no device can open", () => {
  const stranded = { ...base, devices: 1, waitingForKeys: ["list:trip"], stranded: ["list:trip"] };

  it("is said plainly in Settings and can be removed for the account, and isn't also called merely waiting", async () => {
    const removeStranded = vi.fn(async () => undefined);
    render(
      <SyncProviderForTests state={stranded} removeStranded={removeStranded}>
        <SyncSettings />
      </SyncProviderForTests>,
    );
    expect(screen.getByText("This list can’t be opened on any of your devices.")).toBeInTheDocument();
    expect(screen.queryByText(/waiting for a key from another of your devices/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Remove it" }));
    expect(removeStranded).toHaveBeenCalledWith("list:trip");
  });

  it("shows on the lists page for lists only", () => {
    render(
      <SyncProviderForTests state={{ ...stranded, stranded: ["list:trip", "calendar:work"] }}>
        <StrandedZones only="list" />
      </SyncProviderForTests>,
    );
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });

  it("sign-out warns on the only trusted device, and not when there are others", () => {
    const { unmount } = render(
      <SyncProviderForTests state={stranded}>
        <OnlyDeviceNote />
      </SyncProviderForTests>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("This is your only trusted device. Removing its planner here can’t be undone: lists only this device can open will be lost.");
    unmount();
    render(
      <SyncProviderForTests state={base}>
        <OnlyDeviceNote />
      </SyncProviderForTests>,
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
