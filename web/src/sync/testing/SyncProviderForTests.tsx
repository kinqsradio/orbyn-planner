import type { ReactNode } from "react";
import type { SyncController, SyncState } from "../controller";
import { SyncContextForTests } from "../SyncProvider";

/** Gives the sync hooks a controller with a fixed state. Tests only. */
export function SyncProviderForTests({ state, syncNow = () => undefined, children }: { state: SyncState | null; syncNow?: () => void; children: ReactNode }) {
  const controller = state ? ({ getState: () => state, subscribe: () => () => undefined, syncNow } as unknown as SyncController) : null;
  return <SyncContextForTests.Provider value={controller}>{children}</SyncContextForTests.Provider>;
}
