import { useEffect } from "react";
import { useAuth } from "../../auth/AuthProvider";

/**
 * While an account's keys are held in this tab's memory only, a zone made here whose key no other device has yet would be lost with
 * the tab: its data would stay on the server, unreadable. Closing the tab is then asked about first. (A zone's key is sent to the
 * trusted devices when it is made, so this only holds the tab when that send has not finished.)
 */
export function MemoryOnlyGuard() {
  const auth = useAuth();
  const services = auth?.services;
  useEffect(() => {
    if (!services) return;
    let unsent = false;
    const refresh = () =>
      services.keys.loadSyncState().then(
        (state) => {
          unsent = state !== null && Object.keys(state.made).some((zone) => !state.keysSent[zone]);
        },
        () => undefined,
      );
    void refresh();
    const timer = setInterval(() => void refresh(), 2000);
    const ask = (event: BeforeUnloadEvent) => {
      if (!unsent) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", ask);
    return () => {
      clearInterval(timer);
      window.removeEventListener("beforeunload", ask);
    };
  }, [services]);
  return null;
}
