import { useState } from "react";
import { useAuth } from "../../auth/AuthProvider";
import { Icon } from "../../components/Icon";
import { Modal } from "../../components/Modal";
import { AccountSettings } from "./AccountSettings";

/**
 * The account exists but this browser would not store its keys, so they are held in this tab's memory only. "Try saving again" moves
 * them into storage; "Approve another device from this tab" runs the same Add a device flow as Settings, so a device that can keep
 * the keys gets them while this tab stays open. Closing the tab, or signing out, lets them go.
 */
export function KeysNotSaved() {
  const auth = useAuth()!;
  const [busy, setBusy] = useState(false);
  const [approving, setApproving] = useState(false);
  const retry = async () => {
    setBusy(true);
    try {
      await auth.services.keys.moveToStorage();
    } catch {
      // Storage still refuses: the keys stay in memory and the button can be pressed again.
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="public">
      <div className="authcard" role="alert" aria-label="Account created, keys not saved">
        <Icon name="alert" />
        <h1 className="auth-title">Your account is ready, but this browser couldn’t save its keys</h1>
        <p className="t2">Your keys exist only in this tab right now. Keep it open until they’re saved.</p>
        <p className="t3 small">This usually happens in a private window, or when the browser blocks or is out of site storage.</p>
        <div className="pv-line">
          <button type="button" className="btn lg" disabled={busy} onClick={() => void retry()}>{busy ? "Saving…" : "Try saving again"}</button>
          <button type="button" className="ghost lg" onClick={() => setApproving(true)}>
            <Icon name="laptop" small />
            Approve another device from this tab
          </button>
        </div>
        <p className="t4 small">Approving a device you already use, or the Orbyn app on this computer, gives it the keys while this tab is still open. It uses the same matching digits as Add a device.</p>
      </div>
      {approving && (
        <Modal label="Approve another device from this tab" onClose={() => setApproving(false)}>
          <AccountSettings />
        </Modal>
      )}
    </div>
  );
}
