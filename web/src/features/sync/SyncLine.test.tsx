import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SyncLine, healthDelay, useSyncStatus, withPersistence, type SyncStatus } from "./SyncLine";

const cases: [SyncStatus, string][] = [
  [{ kind: "synced", devices: 2 }, "Synced · 2 devices"],
  [{ kind: "connected" }, "Connected"],
  [{ kind: "syncing" }, "Syncing"],
  [{ kind: "offline", waiting: 3 }, "Offline · 3 changes waiting"],
  [{ kind: "offline", waiting: 1 }, "Offline · 1 change waiting"],
  [{ kind: "error" }, "Couldn’t sync"],
  [{ kind: "unsaved", reason: "This device is out of storage." }, "Couldn’t save on this device"],
  [{ kind: "memory" }, "Not saved on this device"],
];

describe("SyncLine", () => {
  it.each(cases)("renders %j", (status, text) => {
    render(<SyncLine status={status} />);
    expect(screen.getByRole("status")).toHaveTextContent(text);
    const retry = screen.queryByRole("button", { name: "Retry" });
    if (status.kind === "error") expect(retry).toBeInTheDocument();
    else expect(retry).not.toBeInTheDocument();
  });

  it("says just Offline when nothing is waiting", () => {
    render(<SyncLine status={{ kind: "offline", waiting: 0 }} />);
    expect(screen.getByRole("status").textContent).toBe("Offline");
  });

  it("Syncing is the blue dot pill and Couldn’t sync the red one, with a ghost Retry beside it", () => {
    const { unmount } = render(<SyncLine status={{ kind: "syncing" }} />);
    expect(screen.getByRole("status")).toHaveClass("st", "info");
    expect(screen.getByRole("status").querySelector(".sd")).not.toBeNull();
    unmount();
    render(<SyncLine status={{ kind: "error" }} onRetry={() => undefined} />);
    expect(screen.getByRole("status")).toHaveClass("st", "err");
    expect(screen.getByRole("button", { name: "Retry" })).toHaveClass("ghost");
    expect(screen.getByRole("status")).not.toContainElement(screen.getByRole("button", { name: "Retry" }));
  });

  it("the offline list says change or changes by the count, and ends with when it last synced", async () => {
    const one = [{ id: "t1", label: "Pick up dry cleaning", at: "2026-11-07T09:41:00" }];
    const { unmount } = render(<SyncLine status={{ kind: "offline", waiting: 1, lastSynced: "2026-11-07T09:38:00" }} waiting={one} />);
    await userEvent.click(screen.getByRole("button", { name: /Offline/ }));
    const list = screen.getByRole("region", { name: "Waiting to sync" });
    expect(list).toHaveTextContent("Your change is saved here and reaches your other devices as soon as you’re back online.");
    expect(list).toHaveTextContent("Last synced09:38");
    unmount();
    render(<SyncLine status={{ kind: "offline", waiting: 2 }} waiting={[...one, { id: "t2", label: "x", at: "2026-11-07T09:42:00" }]} />);
    await userEvent.click(screen.getByRole("button", { name: /Offline/ }));
    expect(screen.getByRole("region", { name: "Waiting to sync" })).toHaveTextContent("Your changes are saved here and reach your other devices");
    expect(screen.queryByText("Last synced")).toBeNull(); // never synced: nothing to say
  });

  it("on a phone the offline pill reads waiting to sync", () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: true, media: q, addEventListener: () => undefined, removeEventListener: () => undefined }));
    try {
      render(<SyncLine status={{ kind: "offline", waiting: 2 }} />);
      expect(screen.getByRole("status")).toHaveTextContent("Offline · 2 changes waiting to sync");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("calls onRetry", async () => {
    const onRetry = vi.fn();
    render(<SyncLine status={{ kind: "error" }} onRetry={onRetry} />);
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});

describe("healthDelay", () => {
  it("slows down while healthy, to five minutes", () => {
    expect([0, 1, 2, 3, 4, 9].map((n) => healthDelay(true, n))).toEqual([15, 30, 60, 120, 300, 300]);
  });
  it("retries a failure quickly, then no slower than a minute", () => {
    expect([0, 1, 2, 3, 4, 9].map((n) => healthDelay(false, n))).toEqual([5, 10, 20, 40, 60, 60]);
  });
});

function Probe() {
  const { status } = useSyncStatus();
  return <SyncLine status={status} />;
}

const ok = () => new Response(JSON.stringify({ status: "ok", version: "1", database: "ok" }));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useSyncStatus", () => {
  it("says Connected when the engine answers", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ok()));
    render(<Probe />);
    expect(screen.getByRole("status")).toHaveTextContent("Syncing");
    expect(await screen.findByText("Connected")).toBeInTheDocument();
  });

  it("ends in the error state when the check times out, never stuck on Syncing", async () => {
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(AbortSignal.abort());
    vi.stubGlobal("fetch", vi.fn((_url: string, init?: RequestInit) => (init?.signal?.aborted ? Promise.reject(new Error("timeout")) : Promise.resolve(ok()))));
    render(<Probe />);
    expect(await screen.findByText(/Couldn’t sync/)).toBeInTheDocument();
    vi.restoreAllMocks();
  });

  it("checks again when the tab becomes visible and when the network returns", async () => {
    const fetchMock = vi.fn(async () => ok());
    vi.stubGlobal("fetch", fetchMock);
    render(<Probe />);
    await screen.findByText("Connected");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(await screen.findByText("Offline")).toBeInTheDocument();
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(await screen.findByText("Connected")).toBeInTheDocument();
  });

  it("never runs two checks at once, so focus changes cannot stack timer loops", async () => {
    let release: (() => void) | undefined;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          release = () => resolve(ok());
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<Probe />);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      release?.();
    });
    expect(await screen.findByText("Connected")).toBeInTheDocument();
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it("keeps checking on a schedule and recovers after a failure", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error("down")).mockImplementation(async () => ok());
    vi.stubGlobal("fetch", fetchMock);
    render(<Probe />);
    expect(await screen.findByText(/Couldn’t sync/)).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_100);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await screen.findByText("Connected")).toBeInTheDocument();
  });
});

describe("withPersistence", () => {
  it("puts storage trouble ahead of every other state", () => {
    const offline: SyncStatus = { kind: "offline", waiting: 2 };
    expect(withPersistence(offline, { status: "ok" })).toBe(offline);
    expect(withPersistence(offline, { status: "memory" })).toEqual({ kind: "memory" });
    expect(withPersistence(offline, { status: "failed", reason: "Full" })).toEqual({ kind: "unsaved", reason: "Full" });
  });

  it("the unsaved pill is red and never claims the changes are saved", () => {
    render(<SyncLine status={{ kind: "unsaved", reason: "This device is out of storage." }} />);
    const pill = screen.getByRole("status");
    expect(pill).toHaveClass("red");
    expect(pill.textContent).not.toMatch(/saved here|are saved/i);
    expect(pill).toHaveTextContent("This device is out of storage.");
  });
});
