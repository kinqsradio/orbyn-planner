import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { authCryptoAvailable } from "../api/authCrypto";
import { configuredEngine } from "../api/feeds";
import { useAuth } from "../auth/AuthProvider";
import { useStore } from "../store/context";
import { SyncController, type SyncState } from "./controller";

const SyncContext = createContext<SyncController | null>(null);
/** The same context, for tests that give it a fixed controller. */
export const SyncContextForTests = SyncContext;

/**
 * Runs sync while a trusted device is signed in and the build has an engine and its module. Anything else
 * (signed out, local only, a pending device) leaves the planner exactly as it was: local.
 */
export function SyncProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const store = useStore();
  const services = auth?.services;
  const deviceId = auth?.session?.deviceId;
  const enabled = auth?.status === "signedIn" && auth.session?.deviceState === "trusted" && configuredEngine() !== null && authCryptoAvailable();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- a new controller per signed-in device, not per render
  const controller = useMemo(() => (enabled && services ? new SyncController(services, store) : null), [enabled, services, store, deviceId]);

  useEffect(() => {
    if (!controller) return;
    controller.start();
    return () => controller.stop();
  }, [controller]);

  return <SyncContext.Provider value={controller}>{children}</SyncContext.Provider>;
}

export const useSyncController = (): SyncController | null => useContext(SyncContext);

const NONE = { subscribe: () => () => undefined, get: () => null as SyncState | null };

/** The state of sync, or null when it isn't running. */
export function useSyncState(): SyncState | null {
  const controller = useSyncController();
  const source = controller ? { subscribe: controller.subscribe, get: controller.getState } : NONE;
  return useSyncExternalStore(source.subscribe, source.get);
}
