import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type { Device } from "../../generated/Device";
import { ApproverController, type ApproverState } from "../../auth/pairing";
import type { StoredSession } from "../../api/keyStore";
import type { AuthServices } from "../../auth/services";

/**
 * This device's side of one approval, for as long as a screen shows it. `attempt` makes a new one (Start again). The approval is
 * started once per controller and ended (cancelled on the server unless it already ended, then let go) when the screen goes away, but
 * only if no mount follows straight after: React's development check unmounts and mounts a screen at once, and must neither start a
 * second approval nor cancel the first.
 */
export function useApprover(services: AuthServices, session: StoredSession, device: Device, attempt: number): { controller: ApproverController; state: ApproverState } {
  const controller = useMemo(() => {
    void attempt; // a new attempt is a new approval
    return new ApproverController(services, session, device);
  }, [services, session, device, attempt]);
  const state = useSyncExternalStore(controller.subscribe, controller.getState);
  const latest = useRef(controller);
  const mounted = useRef(true);
  const started = useRef<ApproverController | null>(null);
  useEffect(() => {
    latest.current = controller;
    mounted.current = true;
    if (started.current !== controller) {
      started.current = controller;
      void controller.start();
    }
    return () => {
      mounted.current = false;
      setTimeout(() => {
        if (mounted.current && latest.current === controller) return;
        const phase = controller.getState().phase;
        if (phase !== "done" && phase !== "closed") void controller.cancel();
        controller.dispose();
      }, 0);
    };
  }, [controller]);
  return { controller, state };
}
