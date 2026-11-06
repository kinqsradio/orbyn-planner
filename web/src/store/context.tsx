import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";
import type { PlannerState, PlannerStore } from "./types";

const StoreContext = createContext<PlannerStore | null>(null);

export function StoreProvider({ store, children }: { store: PlannerStore; children: ReactNode }) {
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function useStore(): PlannerStore {
  const store = useContext(StoreContext);
  if (!store) throw new Error("useStore needs a StoreProvider");
  return store;
}

/** The current tasks, lists and outbox; re-renders on every change. */
export function usePlanner(): PlannerState {
  const store = useStore();
  return useSyncExternalStore(store.subscribe, store.getState);
}
