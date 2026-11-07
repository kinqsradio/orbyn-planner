import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { Device } from "../../generated/Device";
import { useAuth } from "../../auth/AuthProvider";
import { BusyButton } from "../../components/BusyButton";
import { Icon } from "../../components/Icon";
import { Modal } from "../../components/Modal";
import { motionMs } from "../../styles/tokens";
import { ApproverController } from "../../auth/pairing";
import { PLATFORMS, groupCode, when } from "./AccountSettings";

/** The steps with this device's side of the approval: digits to match, the key fingerprint, and what it is waiting for. */
function ApprovalSteps({ device, onClose, onApproved }: { device: Device; onClose: () => void; onApproved: (device: Device) => void }) {
  const auth = useAuth()!;
  const [attempt, setAttempt] = useState(0);
  const controller = useMemo(() => {
    void attempt; // Start again is a new approval
    return new ApproverController(auth.services, auth.session!, device);
  }, [auth.services, auth.session, device, attempt]);
  const state = useSyncExternalStore(controller.subscribe, controller.getState);
  // The digits and the fingerprint stay on screen after They match, and after a timeout, as the frames show them.
  const [compared, setCompared] = useState<{ sas: string; fingerprint: string } | null>(null);
  if (state.phase === "compare" && compared?.sas !== state.sas) setCompared({ sas: state.sas, fingerprint: state.fingerprint });
  const said = state.phase === "confirming" || state.phase === "finishing";
  const waitingFirst = useAfter(state.phase === "starting" || state.phase === "waiting");
  const waitingLast = useAfter(said);
  useEffect(() => {
    void controller.start();
    return () => {
      // Closing in any way (Cancel, Escape, a click outside) ends the approval on the server too, unless it already ended.
      const phase = controller.getState().phase;
      if (phase !== "done" && phase !== "closed") void controller.cancel();
      controller.dispose();
    };
  }, [controller]);
  useEffect(() => {
    if (state.phase === "done") onApproved(device);
  }, [state.phase, device, onApproved]);
  const cancel = () => {
    if (state.phase !== "done" && state.phase !== "closed") void controller.cancel();
    onClose();
  };
  const shown = state.phase === "compare" || said || state.phase === "closed" ? state : null;
  return (
    <>
      <ol className="steps numbered">
        <li><span className="mono t3">1</span><span className="t2">Open Orbyn on your other device.</span></li>
        <li>
          <span className="mono t3">2</span>
          <div>
            <span className="t2">Check the 6 digits match.</span>
            {compared && <div className="card mono code-card" data-testid="approval-code" aria-label={`Code ${compared.sas.split("").join(" ")}`}>{groupCode(compared.sas)}</div>}
          </div>
        </li>
        <li>
          <span className="mono t3">3</span>
          <div>
            <span className="t2">Compare the key fingerprint.</span>
            {compared && <div className="mono fingerprint" data-testid="fingerprint">{compared.fingerprint}</div>}
          </div>
        </li>
      </ol>
      {state.phase === "compare" && <span className="t3 pv-text">Only continue if both match exactly. If they don’t, press Cancel: someone else may be trying to add a device.</span>}
      {said && <span className="t3 pv-text pv-said"><span className="pv-ok"><Icon name="check2" small /></span>You said the digits and fingerprint match.</span>}
      {state.phase === "closed" && state.reason !== "cancelled" && (
        <span className="pv-text pv-timeout" role="alert">
          <Icon name="alert" small />
          {state.reason === "expired" || state.reason === "closed" ? "Your other device didn’t answer in 10 minutes. Nothing was shared." : state.message}
        </span>
      )}
      <div className="pv-waitrow">
        {(waitingFirst || (said && waitingLast)) && (
          <div className="pv-loading t3" role="status">
            <span className="spin blue" aria-hidden="true" />
            {said ? "Waiting for your other device to finish…" : "Waiting for your other device…"}
          </div>
        )}
        <span className="pv-end">
          <button type="button" className="ghost" data-autofocus onClick={cancel}>Cancel</button>
          {shown?.phase === "compare" && <button type="button" className="btn" onClick={() => void controller.confirm()}>They match</button>}
          {shown?.phase === "closed" && shown.reason !== "cancelled" && <button type="button" className="btn" onClick={() => { setCompared(null); setAttempt((n) => n + 1); }}>Start again</button>}
        </span>
      </div>
    </>
  );
}

const KINDS: Record<Device["platform"], string> = { web: "Browser", ios: "Phone", android: "Phone", macos: "Computer", windows: "Computer", linux: "Computer" };
/** "Waiting 4 minutes": how long ago the device signed in. */
const waited = (iso: string, now: number) => {
  const minutes = Math.max(1, Math.round((now - new Date(iso).getTime()) / 60_000));
  return `Waiting ${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
};

/** Approve another device from this tab: waits for a new device to sign in, then walks through the digits and the key fingerprint. */
function ApproveFromTab({ onClose, onApproved }: { onClose: () => void; onApproved: (device: Device) => void }) {
  const { services } = useAuth()!;
  /** Every device waiting for approval; the person chooses, nothing is picked for them. */
  const [waiting, setWaiting] = useState<Device[]>([]);
  const [device, setDevice] = useState<Device | null>(null);
  const [choice, setChoice] = useState<string | null>(null);
  // Exactly one device waiting is the one; with several the person chooses. Once one is shown, another arriving does not replace it.
  if (!device && waiting.length === 1) setDevice(waiting[0]!);
  useEffect(() => {
    let live = true;
    const load = () =>
      services.api.devices().then(
        (list) => live && setWaiting(list.devices.filter((d) => d.state === "pending")),
        () => undefined,
      );
    void load();
    const timer = setInterval(() => void load(), services.poll.maxMs);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [services]);
  const choosing = !device && waiting.length > 1;
  // The newest is selected until the person picks another.
  const newest = [...waiting].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  const selected = choice ?? newest?.id ?? null;
  return (
    <Modal label={choosing ? "Which device is it?" : "Approve another device"} onClose={onClose}>
      <b className="card-title">{choosing ? "Which device is it?" : "Approve another device"}</b>
      {device ? (
        <>
          <div className="kv"><span>Device</span><b>{device.name}</b></div>
          <div className="kv"><span>Kind</span><b>{PLATFORMS[device.platform]}</b></div>
          <div className="kv"><span>When</span><b>{when(device.created_at)}</b></div>
          <ApprovalSteps device={device} onClose={onClose} onApproved={onApproved} />
        </>
      ) : waiting.length > 0 ? (
        <>
          <span className="t3">More than one device is waiting. Choose the one you’re holding.</span>
          <div role="radiogroup" aria-label="Devices" style={{ display: "flex", flexDirection: "column", gap: "var(--sp-8)" }}>
            {waiting.map((d) => (
              <label key={d.id} className={d.id === selected ? "choice on" : "choice"}>
                <input type="radio" name="device" className="sr-only" checked={d.id === selected} onChange={() => setChoice(d.id)} aria-label={d.name} />
                <span className={d.id === selected ? "radio on" : "radio"} aria-hidden="true" />
                <div>
                  <b>{d.name}</b>
                  <small>{KINDS[d.platform]} · {waited(d.created_at, services.now())}</small>
                </div>
              </label>
            ))}
          </div>
          <div className="pv-waitrow">
            <span className="pv-end">
              <button type="button" className="ghost" data-autofocus onClick={onClose}>Cancel</button>
              <button type="button" className="btn" onClick={() => setDevice(waiting.find((d) => d.id === selected) ?? null)}>Continue</button>
            </span>
          </div>
        </>
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

/** True once `active` has been true for the wait (400 ms). */
function useAfter(active: boolean): boolean {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => setDone(true), motionMs("wait"));
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
          <span className="pv-ok"><Icon name="check2" size={22} /></span>
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
        <span className="t4 small">Approving a device you already use gives it the keys while this tab is still open. It uses the same matching digits as Add a device.</span>
      </div>
      {approving && <ApproveFromTab onClose={() => setApproving(false)} onApproved={(d) => { setApproving(false); setApprovedOn(d.name); }} />}
    </div>
  );
}
