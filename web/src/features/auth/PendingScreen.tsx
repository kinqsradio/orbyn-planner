import { useEffect, useMemo, useState, useSyncExternalStore, type FormEvent } from "react";
import { useAuth } from "../../auth/AuthProvider";
import { DeviceController } from "../../auth/pairing";
import { groupCode } from "./AccountSettings";

/**
 * The device signed in but is not trusted yet. A trusted device starts an approval; both screens
 * then show the same six digits and the person confirms on each. Typing the other device's digits
 * is the alternative to tapping "They match".
 */
export function PendingScreen({ repair = false, onDone }: { repair?: boolean; onDone?: () => void } = {}) {
  const auth = useAuth()!;
  const { services } = auth;
  const controller = useMemo(() => new DeviceController(services, auth.session!, repair), [services, auth.session, repair]);
  const state = useSyncExternalStore(controller.subscribe, controller.getState);
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState("");

  useEffect(() => {
    void controller.run();
    return () => controller.dispose();
  }, [controller]);

  const digits = typed.replace(/\D/g, "");
  const submitTyped = (event: FormEvent) => {
    event.preventDefault();
    if (digits.length === 6) controller.confirm(digits);
  };

  return (
    <main className="public-page" id="content" tabIndex={-1}>
      <div className="authcard" aria-label="Approve this device">
        <h1 className="auth-title">{repair ? "Approve this device again" : "Approve this device"}</h1>
        {(state.phase === "waiting" || state.phase === "joining" || state.phase === "joined") && (
          <>
            <p className="t3">
              {auth.session?.email} is already open on another device. Open Orbyn Planner there, go to Settings, Account and choose Approve for this device.
            </p>
            <p className="t3" role="status">{state.phase === "waiting" ? "Waiting for a trusted device to approve this one." : "Connecting to the trusted device…"}</p>
          </>
        )}
        {state.phase === "compare" && (
          <>
            <p className="t3">The other device should show the same 6 digits. Only if they are identical, choose They match.</p>
            <span className="mono code" data-testid="approval-code" aria-label={`Code ${state.sas.split("").join(" ")}`}>{groupCode(state.sas)}</span>
            <div className="dialog-actions">
              <button type="button" className="ghost" onClick={() => void controller.cancel()}>Cancel</button>
              <button type="button" className="btn" onClick={() => controller.confirm()}>They match</button>
            </div>
            {typing ? (
              <form onSubmit={submitTyped}>
                <label htmlFor="approval-code">6-digit code on the other device</label>
                <input id="approval-code" className="field mono-input" inputMode="numeric" autoComplete="off" autoFocus maxLength={7} value={typed} onChange={(e) => setTyped(e.target.value)} />
                <button type="submit" className="btn" disabled={digits.length !== 6}>Continue</button>
              </form>
            ) : (
              <button type="button" className="link-btn quiet-link" onClick={() => setTyping(true)}>Type the code instead</button>
            )}
          </>
        )}
        {state.phase === "finishing" && <p className="t3" role="status">Waiting for the other device to confirm…</p>}
        {state.phase === "trusted" && (
          <>
            <p role="status">This device is trusted.</p>
            <button type="button" className="btn" onClick={() => void controller.continue().then(onDone)}>Continue</button>
          </>
        )}
        {state.phase === "closed" && (
          <>
            <p className="err" role="alert">{state.message}</p>
            {repair ? (
              <button type="button" className="btn" onClick={onDone}>Back to the planner</button>
            ) : (
              <button type="button" className="btn" onClick={() => { setTyping(false); setTyped(""); controller.startAgain(); }}>Start again</button>
            )}
          </>
        )}
        {repair && state.phase === "compare" && <p className="t3 small">A trusted device asked to approve this one again, because it no longer trusts it.</p>}
        <button type="button" className="link-btn quiet-link" onClick={() => void auth.signOut()}>Sign out</button>
      </div>
    </main>
  );
}
