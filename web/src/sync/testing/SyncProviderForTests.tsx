import type { ReactNode } from "react";
import type { SyncController, SyncState } from "../controller";
import { SyncContextForTests } from "../SyncProvider";

/** Gives the sync hooks a controller with a fixed state. Tests only. */
export function SyncProviderForTests({ state, syncNow = () => undefined, removeStranded = async () => undefined, children }: { state: SyncState | null; syncNow?: () => void; removeStranded?: (zone: string) => Promise<void>; children: ReactNode }) {
  const controller = state ? ({ getState: () => state, subscribe: () => () => undefined, syncNow, removeStranded } as unknown as SyncController) : null;
  return <SyncContextForTests.Provider value={controller}>{children}</SyncContextForTests.Provider>;
}
