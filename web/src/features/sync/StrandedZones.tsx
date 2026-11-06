import { useState } from "react";
import { useSyncController, useSyncState } from "../../sync/SyncProvider";

const KIND: Record<string, string> = { list: "list", calendar: "calendar", project: "project" };

/**
 * Zones whose key no device holds: this is the account's only trusted device and it has no key for them (the
 * device that made them was removed, or signed out with its planner removed). Their contents can't be read here
 * or anywhere, so the person is told plainly and can delete them for the account.
 */
export function StrandedZones({ only }: { only?: "list" }) {
  const sync = useSyncState();
  const controller = useSyncController();
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const zones = (sync?.stranded ?? []).filter((z) => !only || z.startsWith(`${only}:`));
  if (zones.length === 0) return null;
  const remove = async (zone: string) => {
    setBusy(zone);
    setFailed(null);
    try {
      await controller?.removeStranded(zone);
    } catch {
      setFailed(zone);
    }
    setBusy(null);
  };
  return (
    <>
      {zones.map((zone) => {
        const kind = KIND[zone.slice(0, zone.indexOf(":"))] ?? "item";
        return (
          <div key={zone} className="card" role="alert" style={{ gap: 6 }}>
            <b style={{ fontWeight: 500 }}>This {kind} can’t be opened on any of your devices.</b>
            <span className="t3 small">The key was only on a device that is gone, so what is in it can’t be read. Removing it deletes it for your account.</span>
            {failed === zone && <span className="err" role="status">Couldn’t remove it. Try again.</span>}
            <div>
              <button type="button" className="ghost danger" disabled={busy === zone} onClick={() => void remove(zone)}>Remove it</button>
            </div>
          </div>
        );
      })}
    </>
  );
}
