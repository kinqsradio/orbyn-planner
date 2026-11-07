import { useEffect, useState, useSyncExternalStore, type FormEvent } from "react";
import { ApiFailure } from "../../api/auth";
import { useNow } from "../../app/clock";
import { useAuth } from "../../auth/AuthProvider";
import { deleteIntent, deletionDay, deletionNotice, useDeletionScheduledAt } from "../../auth/deletionNotice";
import { scheduleDeletion } from "../../auth/flows";
import { BusyButton } from "../../components/BusyButton";
import { Icon } from "../../components/Icon";
import { Modal } from "../../components/Modal";
import { usePlanner } from "../../store/context";
import { describeError } from "./AuthScreens";
import { refreshDeletionNotice, useCancelDeletion } from "./DeletionBanner";

const digits = (value: string) => value.replace(/\D/g, "").slice(0, 6);
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const WEEK_MS = 7 * 86_400_000;

type Step = "form" | "stale" | "scheduled";

/** What Orbyn Planner holds, in the words of the list of what each app loses. */
function PlannerScope() {
  const { tasks, lists, projects, calendars } = usePlanner();
  const open = tasks.filter((t) => t.deletedAt === null).length;
  return (
    <div className="scope2">
      <div>
        <b>Planner: {count(open, "task", "tasks")}, {count(lists.length, "list", "lists")}, {count(projects.length, "project", "projects")}, {count(calendars.length, "calendar", "calendars")}</b>
        <small>And anything you’ve saved in other Orbyn apps.</small>
      </div>
    </div>
  );
}

function DeleteDialog({ onClose }: { onClose: () => void }) {
  const auth = useAuth()!;
  const session = auth.session!;
  const now = useNow();
  /** Whether the account has two-factor on: the engine says. Null until it has. */
  const [totp, setTotp] = useState<boolean | null>(null);
  const [recovery, setRecovery] = useState(false);
  const [factor, setFactor] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("form");
  /** When the deletion was scheduled for, once it is. */
  const [scheduled, setScheduled] = useState<string | null>(null);
  const { cancel, busy: cancelling } = useCancelDeletion();

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

  const day = deletionDay(new Date(now.getTime() + WEEK_MS).toISOString());
  const factorOk = totp === false || (totp === true && (recovery ? factor.trim().length >= 5 : digits(factor).length === 6));
  const trusted = session.deviceState === "trusted";

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!factorOk || busy || totp === null) return;
    setBusy(true);
    setError(null);
    try {
      const at = await scheduleDeletion(auth.services, session, totp ? (recovery ? { recoveryCode: factor.trim() } : { code: digits(factor) }) : {});
      deletionNotice.set(at);
      setScheduled(at);
      setStep("scheduled");
    } catch (e) {
      if (e instanceof ApiFailure && e.code === "reauthentication_required") setStep("stale");
      else if (e instanceof ApiFailure && e.code === "deletion_scheduled") {
        // Already scheduled (another device did it): the banner and the row take over.
        await refreshDeletionNotice(auth.services);
        onClose();
      } else setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  if (!trusted) {
    return (
      <Modal label="Delete your Orbyn account" onClose={onClose}>
        <b className="card-title">Delete your Orbyn account?</b>
        <p className="t3">You can only delete your account from a trusted device. This browser isn’t one. Use the Orbyn app on your Mac or phone, or approve this browser from a trusted device first.</p>
        <div className="dialog-actions">
          <button type="button" className="ghost" data-autofocus onClick={onClose}>Cancel</button>
          <button type="button" className="btn" onClick={onClose}>Approve this browser</button>
        </div>
      </Modal>
    );
  }

  if (step === "stale") {
    return (
      <Modal key="stale" label="Delete your Orbyn account" onClose={onClose}>
        <b className="card-title">Delete your Orbyn account?</b>
        <p className="t3">For your safety, deleting an account needs a sign-in from the last 10 minutes. Sign in again and you’ll come straight back here.</p>
        <div className="dialog-actions">
          <button type="button" className="ghost" data-autofocus onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              deleteIntent.want();
              onClose();
              auth.openAuth("signin");
            }}
          >
            Sign in again
          </button>
        </div>
      </Modal>
    );
  }

  if (step === "scheduled" && scheduled) {
    return (
      <Modal key="scheduled" label="Deletion scheduled" onClose={onClose}>
        <span className="pv-ok"><Icon name="check2" size={22} /></span>
        <b className="card-title">Deletion scheduled</b>
        <span className="t2">Your account will be deleted on {deletionDay(scheduled)}. Everything keeps working until then.</span>
        <span className="t3 small">We emailed {session.email} a link to cancel. It works without signing in.</span>
        <span className="t3 small">Until then you can’t add or remove devices, change protection, change two-factor or sign out everywhere.</span>
        <div className="dialog-actions">
          <button
            type="button"
            className="btn"
            disabled={cancelling}
            onClick={() => {
              void cancel().then(onClose);
            }}
          >
            Cancel deletion
          </button>
          <button type="button" className="ghost" data-autofocus onClick={onClose}>Done</button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal label="Delete your Orbyn account" onClose={busy ? () => undefined : onClose}>
      <form onSubmit={(e) => void submit(e)} aria-label="Delete your Orbyn account" className="delete-form">
        <b className="card-title">Delete your Orbyn account?</b>
        <p className="t3">
          Your account will be deleted on <b style={{ fontWeight: "var(--fw-medium)" }}>{day}, 7 days from now.</b> Until then everything keeps working, and you can cancel from Settings or from the email we send.
        </p>
        <div><PlannerScope /></div>
        <p className="t3">
          After {day}, it is gone from Orbyn’s servers and from every device the next time it opens. This can’t be undone.{" "}
          <button type="button" className="link-btn link" onClick={() => { onClose(); document.getElementById("export-planner")?.click(); }}>Export your data first</button>
        </p>
        {totp === true && (
          <div className="fld">
            <label htmlFor="del-code">{recovery ? "Recovery code" : "Two-factor code"}</label>
            <input
              key={recovery ? "recovery" : "code"}
              id="del-code"
              className="field mono-field"
              inputMode={recovery ? "text" : "numeric"}
              autoComplete="one-time-code"
              autoCapitalize="characters"
              value={factor}
              onChange={(e) => {
                setFactor(e.target.value);
                setError(null);
              }}
              aria-invalid={error ? true : undefined}
              aria-describedby="del-hint"
            />
            <span id="del-hint" className="fld-hint">{recovery ? "Each recovery code works once." : "From your authenticator app."}</span>
            <button type="button" className="link-btn link" onClick={() => { setRecovery(!recovery); setFactor(""); setError(null); }}>
              {recovery ? "Use your authenticator code instead" : "Use a recovery code"}
            </button>
            {error && <span className="err" role="alert">{error}</span>}
          </div>
        )}
        {totp !== true && error && <span className="err" role="alert">{error}</span>}
        <div className="dialog-actions">
          <button type="button" className="ghost" data-autofocus disabled={busy} onClick={onClose}>Cancel</button>
          <BusyButton type="submit" className="danger" busy={busy} disabled={!factorOk || totp === null} idle="Delete account" working="Deleting…" />
        </div>
      </form>
    </Modal>
  );
}

/**
 * The Delete account row, under Export your data so export comes first. While a deletion is scheduled it becomes the date with a
 * Cancel deletion button. Only a signed-in device shows it.
 */
export function DeleteAccountRow() {
  const auth = useAuth();
  const [open, setOpen] = useState(false);
  const scheduled = useDeletionScheduledAt();
  const { cancel, busy } = useCancelDeletion();
  // "Sign in again" from the dialog: once the person has signed in, the dialog is open again.
  const reopened = useSyncExternalStore(deleteIntent.subscribe, deleteIntent.count);
  const [seen, setSeen] = useState(reopened);
  if (reopened !== seen) {
    setSeen(reopened);
    setOpen(true);
  }
  if (!auth?.session) return null;
  const dialog = open ? <DeleteDialog onClose={() => setOpen(false)} /> : null;
  if (scheduled) {
    return (
      <>
        <div className="srow">
          <div className="lab2"><b>Deletion scheduled for {deletionDay(scheduled)}</b><small>Everything still works until then. Cancel any time.</small></div>
          <BusyButton className="btn sm" busy={busy} idle="Cancel deletion" working="Cancelling…" onClick={() => void cancel()} />
        </div>
        {dialog}
      </>
    );
  }
  return (
    <>
      <div className="srow">
        <div className="lab2"><b>Delete account</b><small>Deletes your Orbyn account and its data in every Orbyn app, after 7 days.</small></div>
        <button type="button" className="ghost sm red" onClick={() => setOpen(true)}>Delete account…</button>
      </div>
      {dialog}
    </>
  );
}
