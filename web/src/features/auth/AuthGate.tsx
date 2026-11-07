import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { useAuth } from "../../auth/AuthProvider";
import { deletedAccount } from "../../auth/deletedAccount";
import type { AuthScreen } from "../../auth/AuthProvider";
import { AuthScreens } from "./AuthScreens";
import { DeletedAccountScreen } from "./DeletedAccount";
import { DeletionBanner, DeletionWatcher } from "./DeletionBanner";
import { KeysNotSaved } from "./KeysNotSaved";
import { PendingScreen } from "./PendingScreen";

/**
 * A trusted device can be asked to pair again (another device no longer trusts it). The server
 * returns an approval from `GET /v1/devices/current` for any device it is addressed to, so a signed-in
 * device asks now and then. It only tells the person: nothing is joined, and no nonce is sent, until
 * they tap "Approve this device again". Dismissing hides the notice for that approval.
 */
function useIncomingApproval() {
  const auth = useAuth();
  const [id, setId] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [accepted, setAccepted] = useState<string | null>(null);
  const active = auth?.status === "signedIn";
  const services = auth?.services;
  useEffect(() => {
    if (!active || !services) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const ask = () => {
      services.api.currentDevice().then(
        // Once seen it stays until dealt with: the approval closes when it succeeds.
        (current) => live && setId((was) => current.approval?.id ?? was),
        () => undefined,
      );
      timer = setTimeout(ask, services.poll.maxMs);
    };
    ask();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [active, services]);
  const hidden = id !== null && dismissed.includes(id);
  return {
    id: hidden ? null : id,
    accepted: accepted !== null && accepted === id,
    accept: () => setAccepted(id),
    dismiss: () => {
      if (id) setDismissed((d) => [...d, id]);
      setAccepted(null);
    },
  };
}

/** A passive notice: it joins nothing and sends nothing until the person agrees. */
function RepairNotice({ onApprove, onDismiss }: { onApprove: () => void; onDismiss: () => void }) {
  return (
    <aside className="card" role="status" aria-label="Approval request" style={{ position: "fixed", top: "var(--sp-12)", right: "var(--sp-12)", zIndex: 60, maxWidth: "var(--sp-320)", gap: "var(--sp-8)" }}>
      <b style={{ fontWeight: "var(--fw-medium)" }}>Another device asked to approve this one again</b>
      <span className="t3 small">It no longer trusts this device. If you started that, approve it here and compare the digits on both.</span>
      <div className="dialog-actions">
        <button type="button" className="ghost" onClick={onDismiss}>Dismiss</button>
        <button type="button" className="btn" onClick={onApprove}>Approve this device again</button>
      </div>
    </aside>
  );
}

/** Shows the public pages while signed out, the approval screen while a device waits, and the planner otherwise. */
export function AuthGate({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const incoming = useIncomingApproval();
  const deleted = useSyncExternalStore(deletedAccount.subscribe, deletedAccount.get);
  /** Where the sign-up or sign-in the person chose on the deleted-account screen opens. */
  const [leaveTo, setLeaveTo] = useState<AuthScreen>("landing");
  if (!auth) return <>{children}</>;
  // The account was deleted: nothing else opens until the person has chosen what to do with this browser's copy.
  if (deleted) {
    return (
      <DeletedAccountScreen
        account={deleted}
        services={auth.services}
        onLeave={(to) => {
          setLeaveTo(to);
          deletedAccount.set(null);
        }}
      />
    );
  }
  if (auth.status === "loading") return null;
  if (auth.status === "landing") {
    return (
      <>
        {auth.problem && <p className="err" role="alert" style={{ position: "fixed", top: "var(--sp-8)", left: "var(--sp-16)", right: "var(--sp-16)", zIndex: 60 }}>{auth.problem}</p>}
        <AuthScreens start={leaveTo} />
      </>
    );
  }
  if (auth.status === "pending") {
    return (
      <>
        <DeletionWatcher />
        <DeletionBanner />
        <PendingScreen />
      </>
    );
  }
  // The keys could not be stored: nothing else opens until they are saved or the tab is closed.
  if (auth.status === "signedIn" && auth.keysInMemory && !auth.memoryAccepted) return <KeysNotSaved />;
  if (auth.status === "signedIn" && incoming.id && incoming.accepted) return <PendingScreen key={incoming.id} repair onDone={incoming.dismiss} />;
  // Over the planner (from Settings): the planner stays mounted but hidden, so coming back finds
  // the page as it was. It is always in the same wrapper, which takes no part in the layout.
  return (
    <>
      <div hidden={auth.overlay !== null} style={auth.overlay ? undefined : { display: "contents" }}>
        {children}
      </div>
      {auth.overlay && <AuthScreens start={auth.overlay} />}
      {auth.status === "signedIn" && <DeletionWatcher />}
      {auth.status === "signedIn" && incoming.id && <RepairNotice onApprove={incoming.accept} onDismiss={incoming.dismiss} />}
    </>
  );
}
