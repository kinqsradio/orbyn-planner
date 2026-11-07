import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { Device } from "../../generated/Device";
import { useAuth } from "../../auth/AuthProvider";
import { BusyButton } from "../../components/BusyButton";
import { Icon } from "../../components/Icon";
import { Modal } from "../../components/Modal";
import { ApproverController } from "../../auth/pairing";
import { groupCode } from "./AccountSettings";

/** The steps with this device's side of the approval: digits to match, the key fingerprint, and what it is waiting for. */
function ApprovalSteps({ device, onClose, onApproved }: { device: Device; onClose: () => void; onApproved: (device: Device) => void }) {
  const auth = useAuth()!;
  const controller = useMemo(() => new ApproverController(auth.services, auth.session!, device), [auth.services, auth.session, device]);
  const state = useSyncExternalStore(controller.subscribe, controller.getState);
  const waiting = useAfter(state.phase !== "compare" && state.phase !== "closed" && state.phase !== "done");
  useEffect(() => {
    void controller.start();
    return () => controller.dispose();
  }, [controller]);
  useEffect(() => {
    if (state.phase === "done") onApproved(device);
  }, [state.phase, device, onApproved]);
  const cancel = () => {
    if (state.phase !== "done" && state.phase !== "closed") void controller.cancel();
    onClose();
  };
  return (
    <>
      <ol className="steps numbered">
        <li><span className="mono t3">1</span><span className="t2">Open Orbyn on your other device.</span></li>
        <li>
          <span className="mono t3">2</span>
          <div>
            <span className="t2">Check the 6 digits match.</span>
            {state.phase === "compare" && <div className="card mono code-card" data-testid="approval-code" aria-label={`Code ${state.sas.split("").join(" ")}`}>{groupCode(state.sas)}</div>}
          </div>
        </li>
        <li>
          <span className="mono t3">3</span>
          <div>
            <span className="t2">Compare the key fingerprint.</span>
            {state.phase === "compare" && <div className="mono fingerprint" data-testid="fingerprint">{state.fingerprint}</div>}
          </div>
        </li>
      </ol>
      {state.phase === "closed" && <p className="err" role="alert">{state.message}</p>}
      <div className="pv-waitrow">
        {waiting && <div className="pv-loading t3" role="status"><span className="spin blue" aria-hidden="true" />Waiting for your other device…</div>}
        <span className="pv-end">
          <button type="button" className="ghost" data-autofocus onClick={cancel}>Cancel</button>
          {state.phase === "compare" && <button type="button" className="btn" onClick={() => void controller.confirm()}>They match</button>}
        </span>
      </div>
    </>
  );
}

/** Approve another device from this tab: waits for a new device to sign in, then walks through the digits and the key fingerprint. */
function ApproveFromTab({ onClose, onApproved }: { onClose: () => void; onApproved: (device: Device) => void }) {
  const { services } = useAuth()!;
  const [device, setDevice] = useState<Device | null>(null);
  useEffect(() => {
    let live = true;
    const load = () =>
      services.api.devices().then(
        (list) => live && setDevice((was) => was ?? list.devices.find((d) => d.state === "pending") ?? null),
        () => undefined,
      );
    void load();
    const timer = setInterval(() => void load(), services.poll.maxMs);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [services]);
  return (
    <Modal label="Approve another device" onClose={onClose}>
      <b className="card-title">Approve another device</b>
      {device ? (
        <ApprovalSteps device={device} onClose={onClose} onApproved={onApproved} />
      ) : (
        <>
          <ol className="steps numbered">
            <li><span className="mono t3">1</span><span className="t2">Open Orbyn on your other device.</span></li>
            <li><span className="mono t3">2</span><span className="t2">Check the 6 digits match.</span></li>
            <li><span className="mono t3">3</span><span className="t2">Compare the key fingerprint.</span></li>
          </ol>
          <div className="pv-waitrow">
            <Waiting />
            <span className="pv-end"><button type="button" className="ghost" data-autofocus onClick={onClose}>Cancel</button></span>
          </div>
        </>
      )}
    </Modal>
  );
}

/** The waiting line and its blue spinner, shown only after 400 ms. */
function Waiting() {
  const late = useAfter(true);
  return late ? <div className="pv-loading t3" role="status"><span className="spin blue" aria-hidden="true" />Waiting for your other device…</div> : null;
}

/** True once `active` has been true for 400 ms. */
function useAfter(active: boolean): boolean {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => setDone(true), 400);
    return () => {
      clearTimeout(timer);
      setDone(false);
    };
  }, [active]);
  return active && done;
}

/**
 * The account exists but this browser would not store its keys, so they are held in this tab's memory only. "Try saving again" moves
 * them into storage; "Approve another device from this tab" gives them to a device that can keep them while this tab stays open.
 * Closing the tab, or signing out, lets them go.
 */
export function KeysNotSaved() {
  const auth = useAuth()!;
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [approving, setApproving] = useState(false);
  const [approvedOn, setApprovedOn] = useState<string | null>(null);
  const retry = async () => {
    setBusy(true);
    try {
      await auth.services.keys.moveToStorage();
    } catch {
      // Storage still refuses: the keys stay in memory, and approving another device is the way on.
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  if (approvedOn) {
    return (
      <div className="public">
        <div className="authcard keys-card" role="status" aria-label="Keys approved">
          <Icon name="check" size={22} />
          <h2 className="keys-title">Your keys are on {approvedOn} now.</h2>
          <span className="t2">This browser still can’t keep them, so you’ll sign in again here next time.</span>
          <div className="pv-stack">
            <button type="button" className="btn lg" onClick={auth.acceptMemoryOnly}>Continue</button>
            <button type="button" className="ghost lg" onClick={() => void auth.signOut()}>Sign out of this browser</button>
          </div>
        </div>
      </div>
    );
  }
  const approve = (
    <button type="button" className={failed ? "btn lg" : "ghost lg"} onClick={() => setApproving(true)}>
      <Icon name="laptop" small />
      Approve another device from this tab
    </button>
  );
  return (
    <div className="public">
      <div className="authcard keys-card" role="alert" aria-label="Account created, keys not saved">
        <span className="pv-red"><Icon name="alert" size={22} /></span>
        <h2 className="keys-title">Your account is ready, but this browser couldn’t save its keys</h2>
        <span className="t2">Your keys exist only in this tab right now. Keep it open until they’re saved.</span>
        <span className="t3 pv-text">This usually happens in a private window, or when the browser blocks or is out of site storage.</span>
        <div className="pv-stack">
          {failed && approve}
          <BusyButton className={failed ? "ghost lg" : "btn lg"} busy={busy} idle="Try saving again" working="Saving…" onClick={() => void retry()} />
          {!failed && approve}
        </div>
        {failed && <small className="err" role="alert">Still couldn’t save. This browser may not allow it. Approve another device from this tab instead.</small>}
        <span className="t4 small">Approving a device you already use, or the Orbyn app on this computer, gives it the keys while this tab is still open. It uses the same matching digits as Add a device.</span>
      </div>
      {approving && <ApproveFromTab onClose={() => setApproving(false)} onApproved={(d) => { setApproving(false); setApprovedOn(d.name); }} />}
    </div>
  );
}
