import { createContext, useContext } from "react";

const ClockContext = createContext<() => Date>(() => new Date());

/** Lets tests and previews pin "now". */
export const ClockProvider = ClockContext.Provider;

export function useNow(): Date {
  return useContext(ClockContext)();
}
