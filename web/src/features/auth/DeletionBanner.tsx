import { useEffect, useState, useSyncExternalStore } from "react";
import { cancelDeletion } from "../../auth/flows";
import { useAuth } from "../../auth/AuthProvider";
import type { AuthServices } from "../../auth/services";
import { CANCEL_FAILED_TEXT, cancelFailure, deletionCountdown, deletionNotice, useDeletionScheduledAt } from "../../auth/deletionNotice";
import { useNow } from "../../app/clock";
import { useUi } from "../../app/ui";
import { BusyButton } from "../../components/BusyButton";

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

/** Cancels the scheduled deletion with this device's signature (a pending device may too, within ten minutes of its sign-in). */
export function useCancelDeletion() {
  const auth = useAuth();
  const ui = useUi();
  const [busy, setBusy] = useState(false);
  const failed = useSyncExternalStore(cancelFailure.subscribe, cancelFailure.get);
  const cancel = async () => {
    if (!auth?.session || busy) return;
    setBusy(true);
    cancelFailure.set(false);
    try {
      await cancelDeletion(auth.services, auth.session);
      deletionNotice.set(null);
      ui.showToast("Deletion cancelled. Your account stays as it is.");
    } catch {
      // Nothing changed, so it is still scheduled: the banner and the row say so and the button becomes Try again.
      cancelFailure.set(true);
    } finally {
      setBusy(false);
    }
  };
  return { cancel, busy, failed };
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
  const { cancel, busy, failed } = useCancelDeletion();
  if (!at) return null;
  const when = deletionCountdown(at, now);
  return (
    <aside className="banner warn deletion-banner" role="status" aria-label="Account deletion">
      <span className="dot amber" aria-hidden="true" />
      <b className="banner-title">Deletion scheduled</b>
      <span className="banner-text long">
        Your Orbyn account and everything in it will be deleted {when}.
        {failed && <><br /><span className="err" role="alert">{CANCEL_FAILED_TEXT}</span></>}
      </span>
      <span className="banner-text short">
        Your account will be deleted {when}.
        {failed && <><br /><span className="err">{CANCEL_FAILED_TEXT}</span></>}
      </span>
      <div className="end">
        <BusyButton className="btn sm" busy={busy} idle={failed ? "Try again" : "Cancel deletion"} working="Cancelling…" onClick={() => void cancel()} />
      </div>
    </aside>
  );
}
