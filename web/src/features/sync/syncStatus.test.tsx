import { render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { SyncState } from "../../sync/controller";
import { SyncProviderForTests } from "../../sync/testing/SyncProviderForTests";
import { SyncSettings } from "../settings/SyncSettings";
import { useSyncStatus } from "./SyncLine";

const base: SyncState = { phase: "idle", devices: 2, lastSyncedAt: "2026-11-07T10:00:00Z", quarantined: 0, waitingForKeys: [], keysPending: [], dropped: [], failed: [], skipped: [], error: null, leader: true, live: true };

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
