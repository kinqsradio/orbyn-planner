import { useEffect } from "react";
import { useAuth } from "../../auth/AuthProvider";

/**
 * While an account's keys are held in this tab's memory only, a zone made here whose key no other device has would be lost with the
 * tab: its data would stay on the server, unreadable. Closing the tab is asked about first. A zone is safe only when an envelope with
 * its key was really put for another device (`keysReached`), not merely marked as sent. The answer is worked out when the sync
 * state is saved, never on a timer.
 */
export function MemoryOnlyGuard() {
  const auth = useAuth();
  const services = auth?.services;
  useEffect(() => {
    if (!services) return;
    let unsent = false;
    let live = true;
    const refresh = () =>
      services.keys.loadSyncState().then(
        (state) => {
          if (live) unsent = state !== null && Object.keys(state.made).some((zone) => !state.keysReached?.[zone]);
        },
        () => undefined,
      );
    void refresh();
    const stop = services.keys.subscribeSync(() => void refresh());
    const ask = (event: BeforeUnloadEvent) => {
      if (!unsent) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", ask);
    return () => {
      live = false;
      stop();
      window.removeEventListener("beforeunload", ask);
    };
  }, [services]);
  return null;
}
