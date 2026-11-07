import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "../../auth/AuthProvider";
import { deletionNotice, describeDeletionTime, useDeletionScheduledAt } from "../../auth/deletionNotice";
import { scheduleDeletion, signInAgain } from "../../auth/flows";
import { Modal } from "../../components/Modal";
import { describeError } from "./AuthScreens";
import { useCancelDeletion } from "./DeletionBanner";

const digits = (value: string) => value.replace(/\D/g, "").slice(0, 6);

function DeleteDialog({ onClose }: { onClose: () => void }) {
  const auth = useAuth()!;
  const session = auth.session!;
  const [typed, setTyped] = useState("");
  const [password, setPassword] = useState("");
  /** Whether the account has two-factor on: the engine says. Null until it has. */
  const [totp, setTotp] = useState<boolean | null>(null);
  const [recovery, setRecovery] = useState(false);
  const [factor, setFactor] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** When the deletion was scheduled for, once it is. */
  const [scheduled, setScheduled] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void auth.services.api.currentDevice().then(
      (d) => live && setTotp(d.totp_enabled),
      () => live && setTotp(false),
    );
    return () => {
      live = false;
    };
  }, [auth.services]);

  const emailOk = typed.trim().toLowerCase() === session.email.trim().toLowerCase();
  const factorOk = totp === false || (totp === true && (recovery ? factor.trim().length >= 5 : digits(factor).length === 6));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!emailOk || !factorOk || !password || busy) return;
    setBusy(true);
    setError(null);
    try {
      // The engine asks for a sign-in from the last ten minutes, so the password is asked for again here, whatever the age of this session.
      const fresh = await signInAgain(auth.services, session, password);
      const at = await scheduleDeletion(auth.services, fresh, totp ? (recovery ? { recoveryCode: factor.trim() } : { code: digits(factor) }) : {});
      deletionNotice.set(at);
      setScheduled(at);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  if (scheduled) {
    return (
      <Modal label="Deletion scheduled" onClose={onClose}>
        <div>
          <b className="card-title">Your account will be deleted on {describeDeletionTime(scheduled)}</b>
          <p className="t3 small">
            We emailed you a link to cancel. Until then your account works as usual, so you can still export your planner. You can cancel any time from the banner, from Settings, or by signing in on any device.
          </p>
          <div className="dialog-actions">
            <button type="button" className="btn" data-autofocus onClick={onClose}>Done</button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal label="Delete your account" onClose={busy ? () => undefined : onClose}>
      <form onSubmit={(e) => void submit(e)} aria-label="Delete your account">
        <b className="card-title">Delete your account?</b>
        <p className="t3 small">
          This deletes your account and everything in it, on every device and from Orbyn’s servers: your tasks, lists, projects, tags and calendars. It happens in 7 days, and you can cancel until then. After that it can’t be undone, and Orbyn can’t get any of it back. Export your planner first if you want a copy.
        </p>
        <div className="form" style={{ width: "auto" }}>
          <label htmlFor="del-email">Type your email, <b style={{ fontWeight: 500 }}>{session.email}</b>, to confirm</label>
          <input id="del-email" className="field" type="email" autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} data-autofocus />
          <label htmlFor="del-password">Your password, to sign in again</label>
          <input id="del-password" className="field" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          {totp === true && (
            <>
              <label htmlFor="del-code">{recovery ? "Recovery code" : "Code from your authenticator app"}</label>
              <input
                key={recovery ? "recovery" : "code"}
                id="del-code"
                className="field"
                inputMode={recovery ? "text" : "numeric"}
                autoComplete="one-time-code"
                autoCapitalize="characters"
                placeholder={recovery ? "XXXXX-XXXXX" : "123456"}
                value={factor}
                onChange={(e) => setFactor(e.target.value)}
              />
              <button type="button" className="link-btn" onClick={() => { setRecovery(!recovery); setFactor(""); setError(null); }}>
                {recovery ? "Use a code from the app" : "Use a recovery code"}
              </button>
            </>
          )}
        </div>
        {error && <p className="err" role="alert">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="ghost" disabled={busy} onClick={onClose}>Cancel</button>
          <button type="submit" className="btn danger" disabled={busy || !emailOk || !factorOk || !password || totp === null}>{busy ? "Scheduling…" : "Delete account"}</button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * Settings · Privacy · Your data: the "Delete my account" row, or, while a deletion is scheduled, when it will happen and a way to
 * cancel it. Only a trusted device can ask, so only a trusted device shows the first.
 */
export function DeleteAccountRow() {
  const auth = useAuth();
  const [open, setOpen] = useState(false);
  const scheduled = useDeletionScheduledAt();
  const { cancel, busy, error } = useCancelDeletion();
  if (!auth?.session) return null;
  // The dialog outlives the row: scheduling changes the row to "Cancel deletion" while the dialog still tells the person when.
  const dialog = open ? <DeleteDialog onClose={() => setOpen(false)} /> : null;
  if (scheduled) {
    return (
      <>
        <div style={{ borderTop: "1px solid var(--line)" }}>
          <div className="kv" style={{ minHeight: 44 }}>
            <span>Deletion scheduled for {describeDeletionTime(scheduled)}</span>
            <button type="button" className="ghost" disabled={busy} onClick={() => void cancel()}>{busy ? "Cancelling…" : "Cancel deletion"}</button>
          </div>
          {error && <p className="err" role="alert">{error}</p>}
        </div>
        {dialog}
      </>
    );
  }
  if (auth.session.deviceState !== "trusted") return null;
  return (
    <>
      <div className="kv" style={{ height: 44, borderTop: "1px solid var(--line)" }}>
        <span>Delete my account</span>
        <button type="button" className="ghost danger" onClick={() => setOpen(true)}>Delete…</button>
      </div>
      {dialog}
    </>
  );
}
