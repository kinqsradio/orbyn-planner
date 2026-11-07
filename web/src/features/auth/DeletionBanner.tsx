import { useEffect, useState } from "react";
import { ApiFailure } from "../../api/auth";
import { cancelDeletion } from "../../auth/flows";
import { useAuth } from "../../auth/AuthProvider";
import { deletionNotice, describeDeletionTime, useDeletionScheduledAt } from "../../auth/deletionNotice";
import { describeError } from "./AuthScreens";

/** Keeps `deletionNotice` current from the engine while a device is signed in (trusted or still waiting): every device sees the date. */
function useDeletionPoll() {
  const auth = useAuth();
  const active = auth?.status === "signedIn" || auth?.status === "pending";
  const services = auth?.services;
  useEffect(() => {
    if (!active || !services) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const ask = () => {
      services.api.currentDevice().then(
        (current) => live && deletionNotice.set(current.deletion_scheduled_at ?? null),
        () => undefined,
      );
      timer = setTimeout(ask, services.poll.maxMs);
    };
    ask();
    return () => {
      live = false;
      clearTimeout(timer);
      deletionNotice.set(undefined);
    };
  }, [active, services]);
}

/**
 * Cancels the scheduled deletion with this device's signature. A pending device may too, but only within ten minutes of its
 * sign-in: when the engine says so (`reauthentication_required`), `again` is true and the person is offered a new sign-in, with
 * the cancel waiting for them there.
 */
export function useCancelDeletion() {
  const auth = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [again, setAgain] = useState(false);
  const cancel = async () => {
    if (!auth?.session || busy) return;
    setBusy(true);
    setError(null);
    setAgain(false);
    try {
      await cancelDeletion(auth.services, auth.session);
      deletionNotice.set(null);
    } catch (e) {
      setError(describeError(e));
      setAgain(e instanceof ApiFailure && e.code === "reauthentication_required");
    } finally {
      setBusy(false);
    }
  };
  const signInAgain = async () => {
    deletionNotice.setIntent(true);
    await auth?.signOut();
  };
  return { cancel, busy, error, again, signInAgain };
}

/** On every signed-in device, and on one waiting for approval: the deletion is scheduled, when, and a way to cancel it. */
export function DeletionBanner() {
  useDeletionPoll();
  const at = useDeletionScheduledAt();
  const { cancel, busy, error, again, signInAgain } = useCancelDeletion();
  if (!at) return null;
  return (
    <aside className="card" role="status" aria-label="Account deletion" style={{ position: "fixed", top: 12, left: "50%", transform: "translateX(-50%)", zIndex: 60, maxWidth: 520, width: "calc(100% - 24px)", gap: 8 }}>
      <b style={{ fontWeight: 500 }}>Your account will be deleted on {describeDeletionTime(at)}</b>
      <span className="t3 small">Everything in it goes then. Until then it works as usual. If this wasn’t you, cancel now.</span>
      {error && <span className="err" role="alert">{error}</span>}
      <div className="dialog-actions">
        {again && <button type="button" className="ghost" onClick={() => void signInAgain()}>Sign in again</button>}
        <button type="button" className="btn" disabled={busy} onClick={() => void cancel()}>{busy ? "Cancelling…" : "Cancel deletion"}</button>
      </div>
    </aside>
  );
}
