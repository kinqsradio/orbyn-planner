import { useCallback, useEffect, useState } from "react";
import { getHealth } from "../../api/engine";

export type SyncStatus =
  | { kind: "synced"; devices: number }
  | { kind: "syncing" }
  | { kind: "offline"; waiting: number }
  | { kind: "error" };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function SyncLine({ status, onRetry }: { status: SyncStatus; onRetry?: () => void }) {
  switch (status.kind) {
    case "synced":
      return (
        <p className="sync-line" role="status">
          <span className="sync-dot" aria-hidden="true" />
          Synced · {plural(status.devices, "device", "devices")}
        </p>
      );
    case "syncing":
      return (
        <p className="sync-line" role="status">
          <span className="sync-dot sync-dot-live" aria-hidden="true" />
          Syncing
        </p>
      );
    case "offline":
      return (
        <p className="sync-line" role="status">
          <span className="sync-dot sync-dot-hollow" aria-hidden="true" />
          Offline · {plural(status.waiting, "change", "changes")} waiting
        </p>
      );
    case "error":
      return (
        <p className="sync-line sync-line-error" role="status">
          <span className="sync-dot" aria-hidden="true" />
          Couldn’t sync ·{" "}
          <button type="button" className="link-button" onClick={onRetry}>
            Retry
          </button>
        </p>
      );
  }
}

/** Derives the sync status from the browser's connection and the engine health check. */
export function useSyncStatus(): { status: SyncStatus; retry: () => void } {
  const [online, setOnline] = useState(() => navigator.onLine);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ attempt: number; ok: boolean } | null>(null);

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
    getHealth(controller.signal)
      .then((h) => setResult({ attempt, ok: h.status === "ok" }))
      .catch(() => {
        if (!controller.signal.aborted) setResult({ attempt, ok: false });
      });
    return () => controller.abort();
  }, [online, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  let status: SyncStatus;
  if (!online) status = { kind: "offline", waiting: 0 };
  else if (result?.attempt !== attempt) status = { kind: "syncing" };
  else if (result.ok) status = { kind: "synced", devices: 1 };
  else status = { kind: "error" };
  return { status, retry };
}
