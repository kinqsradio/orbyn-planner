import { useSyncController, useSyncState } from "../../sync/SyncProvider";
import { formatTime } from "../../lib/dates";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Where sync stands, and what to do about it. Nothing here when this device isn't syncing. */
export function SyncSettings() {
  const sync = useSyncState();
  const controller = useSyncController();
  if (!sync || sync.phase === "off") return null;
  const when = sync.lastSyncedAt ? `Last synced ${formatTime(new Date(sync.lastSyncedAt))}` : "Not synced yet";
  const line =
    sync.phase === "syncing"
      ? "Syncing…"
      : sync.phase === "offline"
        ? "Offline. Your changes are saved here and will go when you’re back online."
        : sync.phase === "error"
          ? (sync.error ?? "Couldn’t sync.")
          : `Synced · ${plural(sync.devices, "device", "devices")}`;
  return (
    <>
      <div className="bh"><b>Sync</b><span></span></div>
      <div className="card" style={{ gap: 6 }}>
        <span role="status">{line}</span>
        <span className="t3 small">{when}{sync.live ? " · Live" : ""}</span>
        {sync.quarantined > 0 && (
          <p className="t3 small" role="note">
            {plural(sync.quarantined, "item", "items")} from your other devices can’t be opened on this one yet. They are kept and open as soon as the key arrives; approve this device from one you already use if it doesn’t.
          </p>
        )}
        {sync.waitingForKeys.length > 0 && (
          <p className="t3 small" role="note">
            {plural(sync.waitingForKeys.length, "list or calendar", "lists and calendars")} here {sync.waitingForKeys.length === 1 ? "is" : "are"} waiting for a key from another of your devices before {sync.waitingForKeys.length === 1 ? "it" : "they"} can be sent.
          </p>
        )}
        {sync.keysPending.length > 0 && (
          <p className="t3 small" role="note">
            Your other devices haven’t been given the keys for {plural(sync.keysPending.length, "list or calendar", "lists and calendars")} yet. Nothing is sent to {sync.keysPending.length === 1 ? "it" : "them"} until they have; this tries again by itself.
          </p>
        )}
        {sync.dropped.length > 0 && (
          <p className="t3 small" role="note">
            {plural(sync.dropped.length, "list or calendar was", "lists or calendars were")} deleted on another device, so the changes you hadn’t sent for {sync.dropped.length === 1 ? "it" : "them"} were dropped.
          </p>
        )}
        {sync.failed.length > 0 && (
          <p className="t3 small" role="note">
            {plural(sync.failed.length, "change", "changes")} can’t be sent because {sync.failed.length === 1 ? "it is" : "they are"} too large. Editing {sync.failed.length === 1 ? "it" : "them"} again tries again.
          </p>
        )}
        {sync.skipped.length > 0 && (
          <p className="t3 small" role="note">
            The server refused changes to {plural(sync.skipped.length, "list or calendar", "lists and calendars")}. Sync is trying again later, and the rest carries on.
          </p>
        )}
        <div>
          <button type="button" className="ghost" onClick={() => controller?.syncNow()}>Sync now</button>
        </div>
      </div>
    </>
  );
}
