import { useCallback, useEffect, useState } from "react";
import { getHealth } from "../../api/engine";
import { Icon } from "../../components/Icon";
import { PHONE_QUERY, useMediaQuery } from "../../components/useMediaQuery";
import { formatTime } from "../../lib/dates";
import type { SyncState } from "../../sync/controller";

export type SyncStatus =
  | { kind: "synced"; devices: number }
  /** The engine answers. Real sync, and so "Synced", arrives with the sync phase. */
  | { kind: "connected" }
  | { kind: "syncing" }
  /** `lastSynced`: when this device last reached the server, if it ever did. */
  | { kind: "offline"; waiting: number; lastSynced?: string | null }
  | { kind: "error" }
  /** Changes did not reach this device's storage. Red: a failure. */
  | { kind: "unsaved"; reason: string }
  /** IndexedDB is missing, so nothing outlives this visit. */
  | { kind: "memory" };

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
  const phone = useMediaQuery(PHONE_QUERY);
  // On a phone the pill is a banner, and it says what is waiting for what (Planner Designs p-phone-offline).
  const text = status.waiting === 0 ? "Offline" : `Offline · ${plural(status.waiting, "change", "changes")} waiting${phone ? " to sync" : ""}`;
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
            {status.waiting === 1
              ? "This device is offline. Your change is saved here and reaches your other devices as soon as you’re back online."
              : "This device is offline. Your changes are saved here and reach your other devices as soon as you’re back online."}
          </span>
          {waiting.slice(0, 5).map((w) => (
            <div className="kv" key={w.id} style={{ borderTop: "var(--bw) solid var(--line)", height: "var(--sp-38)" }}>
              <span style={{ color: "var(--t1)" }}>{w.label}</span>
              <b>Edited {formatTime(new Date(w.at))}</b>
            </div>
          ))}
          {status.lastSynced && (
            <div className="kv" style={{ borderTop: "var(--bw) solid var(--line)", height: "var(--sp-38)" }}>
              <span>Last synced</span>
              <b>{formatTime(new Date(status.lastSynced))}</b>
            </div>
          )}
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
        <span className="st info" role="status">
          <span className="sd" />
          Syncing
        </span>
      );
    case "offline":
      return <OfflinePill status={status} waiting={waiting} />;
    case "unsaved":
      return (
        <p className="pillx red" role="status" title={status.reason}>
          Couldn’t save on this device
          <span className="sr-only"> {status.reason}</span>
        </p>
      );
    case "memory":
      return <p className="pillx" role="status">Not saved on this device</p>;
    case "error":
      return (
        <>
          <span className="st err" role="status">
            <span className="sd" />
            Couldn’t sync
          </span>
          <button type="button" className="ghost" onClick={onRetry}>
            Retry
          </button>
        </>
      );
  }
}

/** Storage trouble comes first: when changes are not safe on this device, no other state is worth showing. */
export function withPersistence(status: SyncStatus, persistence: { status: string; reason?: string }): SyncStatus {
  if (persistence.status === "failed") return { kind: "unsaved", reason: persistence.reason ?? "" };
  if (persistence.status === "memory") return { kind: "memory" };
  return status;
}

/** Seconds until the next health check: slowing down while healthy, quick to retry a failure. */
export function healthDelay(healthy: boolean, streak: number): number {
  if (healthy) return [15, 30, 60, 120, 300][Math.min(streak, 4)]!;
  return Math.min(5 * 2 ** streak, 60);
}

/** Derives the sync status from the connection, the engine health check and the changes waiting. */
export function useSyncStatus(pending = 0, sync: SyncState | null = null, syncNow?: () => void): { status: SyncStatus; retry: () => void } {
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

  const syncing = sync !== null && sync.phase !== "off";
  useEffect(() => {
    // Real sync knows better than a health check does.
    if (!online || syncing) return;
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
  }, [online, attempt, syncing]);

  const retry = useCallback(() => {
    if (syncNow) syncNow();
    setHealthy(null);
    setAttempt((n) => n + 1);
  }, [syncNow]);

  let status: SyncStatus;
  if (syncing && sync) {
    if (sync.phase === "offline" || !online) status = { kind: "offline", waiting: pending, lastSynced: sync.lastSyncedAt };
    else if (sync.phase === "error") status = { kind: "error" };
    else if (sync.phase === "syncing" || sync.lastSyncedAt === null) status = { kind: "syncing" };
    else status = { kind: "synced", devices: sync.devices };
  } else if (!online) status = { kind: "offline", waiting: pending };
  else if (healthy === null) status = { kind: "syncing" };
  else if (healthy) status = { kind: "connected" };
  else status = { kind: "error" };
  return { status, retry };
}
