import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SyncLine, healthDelay, useSyncStatus, type SyncStatus } from "./SyncLine";

const cases: [SyncStatus, string][] = [
  [{ kind: "synced", devices: 2 }, "Synced · 2 devices"],
  [{ kind: "connected" }, "Connected"],
  [{ kind: "syncing" }, "Syncing"],
  [{ kind: "offline", waiting: 3 }, "Offline · 3 changes waiting"],
  [{ kind: "offline", waiting: 1 }, "Offline · 1 change waiting"],
  [{ kind: "error" }, "Couldn’t sync ·"],
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
