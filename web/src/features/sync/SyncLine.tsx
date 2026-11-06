import { useCallback, useEffect, useState } from "react";
import { getHealth } from "../../api/engine";
import { Icon } from "../../components/Icon";
import { formatTime } from "../../lib/dates";

export type SyncStatus =
  | { kind: "synced"; devices: number }
  /** The engine answers. Real sync, and so "Synced", arrives with the sync phase. */
  | { kind: "connected" }
  | { kind: "syncing" }
  | { kind: "offline"; waiting: number }
  | { kind: "error" };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export interface WaitingChange {
  id: string;
  label: string;
  /** ISO time of the last local edit. */
  at: string;
}

/** The offline pill; tapping it lists the changes that have not left this device. */
function OfflinePill({ status, waiting }: { status: Extract<SyncStatus, { kind: "offline" }>; waiting: WaitingChange[] }) {
  const [open, setOpen] = useState(false);
  const text = status.waiting === 0 ? "Offline" : `Offline · ${plural(status.waiting, "change", "changes")} waiting`;
  if (status.waiting === 0 || waiting.length === 0) {
    return (
      <p className="pillx offline" role="status">
        <Icon name="x" small />
        {text}
      </p>
    );
  }
  return (
    <div className="sync-wrap">
      <p role="status" style={{ display: "contents" }}>
        <button type="button" className="pillx offline" aria-expanded={open} onClick={() => setOpen(!open)}>
          <Icon name="x" small />
          {text}
        </button>
      </p>
      {open && (
        <div className="card popover" role="region" aria-label="Waiting to sync">
          <b>Waiting to sync</b>
          <span className="t3">
            This device is offline. Your changes are saved here and reach your other devices as soon as you’re back online.
          </span>
          {waiting.slice(0, 5).map((w) => (
            <div className="kv" key={w.id} style={{ borderTop: "1px solid var(--line)", height: 38 }}>
              <span style={{ color: "var(--t1)" }}>{w.label}</span>
              <b>Edited {formatTime(new Date(w.at))}</b>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function SyncLine({ status, onRetry, waiting = [] }: { status: SyncStatus; onRetry?: () => void; waiting?: WaitingChange[] }) {
  switch (status.kind) {
    case "synced":
      return <p className="pillx" role="status">Synced · {plural(status.devices, "device", "devices")}</p>;
    case "connected":
      return <p className="pillx" role="status">Connected</p>;
    case "syncing":
      return (
        <p className="pillx" role="status">
          <span className="spin" aria-hidden="true" />
          Syncing
        </p>
      );
    case "offline":
      return <OfflinePill status={status} waiting={waiting} />;
    case "error":
      return (
        <p className="pillx red" role="status">
          Couldn’t sync ·{" "}
          <button type="button" onClick={onRetry}>
            Retry
          </button>
        </p>
      );
  }
}

/** Seconds until the next health check: slowing down while healthy, quick to retry a failure. */
export function healthDelay(healthy: boolean, streak: number): number {
  if (healthy) return [15, 30, 60, 120, 300][Math.min(streak, 4)]!;
  return Math.min(5 * 2 ** streak, 60);
}

/** Derives the sync status from the connection, the engine health check and the changes waiting. */
export function useSyncStatus(pending = 0): { status: SyncStatus; retry: () => void } {
  const [online, setOnline] = useState(() => navigator.onLine);
  const [attempt, setAttempt] = useState(0);
  const [healthy, setHealthy] = useState<boolean | null>(null);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  useEffect(() => {
    if (!online) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let streak = 0;
    let last: boolean | null = null;

    // One check at a time: a visibility change during a slow check must not
    // start a second loop of timers.
    let inFlight = false;
    const check = async () => {
      if (inFlight) return;
      inFlight = true;
      clearTimeout(timer);
      let ok: boolean;
      try {
        ok = (await getHealth(controller.signal)).status === "ok";
      } catch {
        ok = false;
      } finally {
        inFlight = false;
      }
      if (controller.signal.aborted) return;
      streak = ok === last ? streak + 1 : 0;
      last = ok;
      setHealthy(ok);
      clearTimeout(timer);
      timer = setTimeout(check, healthDelay(ok, streak) * 1000);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };

    void check();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      controller.abort();
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [online, attempt]);

  const retry = useCallback(() => {
    setHealthy(null);
    setAttempt((n) => n + 1);
  }, []);

  let status: SyncStatus;
  if (!online) status = { kind: "offline", waiting: pending };
  else if (healthy === null) status = { kind: "syncing" };
  else if (healthy) status = { kind: "connected" };
  else status = { kind: "error" };
  return { status, retry };
}
