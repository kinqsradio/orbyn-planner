import { useState } from "react";
import { useSyncController, useSyncState } from "../../sync/SyncProvider";
import { useStore } from "../../store/context";
import { Modal } from "../auth/AccountSettings";

const KIND: Record<string, string> = { list: "list", calendar: "calendar", project: "project" };

export const NEEDS_APPROVAL = "This device needs to be approved again to open your lists. Approve it from another of your devices.";

/**
 * What this device can't open, in one place. After its saved state was lost it trusts nobody, so it says that it needs
 * to be approved again (and nothing is called stranded or waiting). Zones whose key no device holds: this is the
 * account's only trusted device and it has no key for them (the device that made them was removed, or signed out with
 * its planner removed). Their contents can't be read here or anywhere, so the person is told plainly and can delete
 * them for the account, after a confirmation.
 */
export function StrandedZones({ only }: { only?: "list" }) {
  const sync = useSyncState();
  const controller = useSyncController();
  const store = useStore();
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const zones = (sync?.stranded ?? []).filter((z) => !only || z.startsWith(`${only}:`));
  if (sync?.needsApproval) {
    return (
      <div className="card" role="alert" style={{ gap: 6 }}>
        <b style={{ fontWeight: 500 }}>{NEEDS_APPROVAL}</b>
        <span className="t3 small">Nothing is lost: your changes here are kept and are sent once it is approved.</span>
      </div>
    );
  }
  if (zones.length === 0) return null;
  const nameOf = (zone: string) => {
    const id = zone.slice(zone.indexOf(":") + 1);
    return store.getState().lists.find((l) => l.id === id)?.name ?? store.getState().calendars.find((c) => c.id === id)?.name ?? `this ${KIND[zone.slice(0, zone.indexOf(":"))] ?? "item"}`;
  };
  const remove = async (zone: string) => {
    setAsking(null);
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
              <button type="button" className="ghost danger" disabled={busy === zone} onClick={() => setAsking(zone)}>Remove it</button>
            </div>
          </div>
        );
      })}
      {asking && (
        <Modal label="Delete on every device" onClose={() => setAsking(null)}>
          <b className="card-title">Delete “{nameOf(asking)}” on every device? This can’t be undone.</b>
          <div className="dialog-actions">
            <button type="button" className="ghost" data-autofocus onClick={() => setAsking(null)}>Cancel</button>
            <button type="button" className="btn danger" onClick={() => void remove(asking)}>Delete</button>
          </div>
        </Modal>
      )}
    </>
  );
}
