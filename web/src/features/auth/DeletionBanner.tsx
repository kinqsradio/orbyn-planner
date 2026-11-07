import { useEffect, useState } from "react";
import { ApiFailure } from "../../api/auth";
import { cancelDeletion } from "../../auth/flows";
import { useAuth } from "../../auth/AuthProvider";
import type { AuthServices } from "../../auth/services";
import { deletionDay, deletionIn, deletionNotice, useDeletionScheduledAt } from "../../auth/deletionNotice";
import { useNow } from "../../app/clock";
import { useUi } from "../../app/ui";
import { BusyButton } from "../../components/BusyButton";
import { describeError } from "./AuthScreens";

/** Keeps `deletionNotice` current from the engine while a device is signed in (trusted or still waiting): every device sees the date. */
export function useDeletionPoll() {
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
  const ui = useUi();
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
      ui.showToast("Deletion cancelled. Your account stays as it is.");
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

/** Asks the engine for the scheduled date now (a refusal said it is scheduled), instead of waiting for the next check. */
export async function refreshDeletionNotice(services: AuthServices): Promise<void> {
  try {
    deletionNotice.set((await services.api.currentDevice()).deletion_scheduled_at ?? null);
  } catch {
    // The next check finds out.
  }
}

/** Keeps the date current while a device is signed in or waiting. Renders nothing. */
export function DeletionWatcher() {
  useDeletionPoll();
  return null;
}

/**
 * On every screen of every app while a deletion is scheduled: amber, because keeping the account needs the person to act. It counts
 * the days, offers Cancel deletion, and can't be dismissed.
 */
export function DeletionBanner() {
  const at = useDeletionScheduledAt();
  const now = useNow();
  const { cancel, busy, error, again, signInAgain } = useCancelDeletion();
  if (!at) return null;
  const day = deletionDay(at);
  const left = deletionIn(at, now);
  return (
    <aside className="banner warn deletion-banner" role="status" aria-label="Account deletion">
      <span className="dot amber" aria-hidden="true" />
      <b className="banner-title">Deletion scheduled</b>
      <span className="banner-text long">Your Orbyn account and everything in it will be deleted on {day}, {left}.</span>
      <span className="banner-text short">Your account will be deleted on {day}, {left}.</span>
      {error && <span className="err" role="alert">{error}</span>}
      <div className="end">
        {again && <button type="button" className="ghost sm" onClick={() => void signInAgain()}>Sign in again</button>}
        <BusyButton className="btn sm" busy={busy} idle="Cancel deletion" working="Cancelling…" onClick={() => void cancel()} />
      </div>
    </aside>
  );
}
