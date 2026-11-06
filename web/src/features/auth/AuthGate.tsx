import { useEffect, useState, type ReactNode } from "react";
import { useAuth } from "../../auth/AuthProvider";
import { AuthScreens } from "./AuthScreens";
import { PendingScreen } from "./PendingScreen";

/**
 * A trusted device can be asked to pair again (another device no longer trusts it). The server
 * returns an approval from `GET /v1/devices/current` for any device it is addressed to, so a signed-in
 * device asks now and then, and shows the same comparison screen when there is one.
 */
function useIncomingApproval(): { id: string | null; dismiss: () => void } {
  const auth = useAuth();
  const [id, setId] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const active = auth?.status === "signedIn";
  const services = auth?.services;
  useEffect(() => {
    if (!active || !services) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const ask = () => {
      services.api.currentDevice().then(
        // Once shown, the screen stays until the person leaves it: the approval closes when it succeeds.
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
  return { id: id !== dismissed ? id : null, dismiss: () => setDismissed(id) };
}

/** Shows the public pages while signed out, the approval screen while a device waits, and the planner otherwise. */
export function AuthGate({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const incoming = useIncomingApproval();
  if (!auth) return <>{children}</>;
  if (auth.status === "loading") return null;
  if (auth.status === "landing") return <AuthScreens start="landing" />;
  if (auth.status === "pending") return <PendingScreen />;
  if (auth.status === "signedIn" && incoming.id) return <PendingScreen key={incoming.id} repair onDone={incoming.dismiss} />;
  // Over the planner (from Settings): the planner stays mounted but hidden, so coming back finds
  // the page as it was. It is always in the same wrapper, which takes no part in the layout.
  return (
    <>
      <div hidden={auth.overlay !== null} style={auth.overlay ? undefined : { display: "contents" }}>
        {children}
      </div>
      {auth.overlay && <AuthScreens start={auth.overlay} />}
    </>
  );
}
