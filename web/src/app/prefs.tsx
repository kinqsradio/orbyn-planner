import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

export interface Prefs {
  /** The first day of the week in the month view and a 7-day week. */
  weekStart: "mon" | "sun";
  /** Days in the Week view: the whole week, or Monday to Friday (which still shows 7 on a weekend of the current week). */
  weekDays: 5 | 7;
}

export const DEFAULT_PREFS: Prefs = { weekStart: "mon", weekDays: 7 };
export const PREFS_KEY = "orbyn-planner.prefs";

function read(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as Partial<Prefs>;
    return {
      weekStart: raw.weekStart === "sun" ? "sun" : "mon",
      weekDays: raw.weekDays === 5 ? 5 : 7,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

interface PrefsApi {
  prefs: Prefs;
  setPrefs: (patch: Partial<Prefs>) => void;
}

const PrefsContext = createContext<PrefsApi | null>(null);

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [prefs, setState] = useState<Prefs>(read);
  const setPrefs = useCallback((patch: Partial<Prefs>) => {
    setState((current) => {
      const next = { ...current, ...patch };
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(next));
      } catch {
        // Storage can be blocked; the choice then lasts for this visit only.
      }
      return next;
    });
  }, []);
  const value = useMemo(() => ({ prefs, setPrefs }), [prefs, setPrefs]);
  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>;
}

export function usePrefs(): PrefsApi {
  const api = useContext(PrefsContext);
  if (!api) throw new Error("usePrefs needs a PrefsProvider");
  return api;
}
