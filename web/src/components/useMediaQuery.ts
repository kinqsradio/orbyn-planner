import { useSyncExternalStore } from "react";
import { PHONE_MAX_PX } from "../styles/tokens";

/** Follows a media query, so the answer changes when the window or device does. False where matchMedia does not exist. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      if (typeof window.matchMedia !== "function") return () => undefined;
      const list = window.matchMedia(query);
      list.addEventListener("change", notify);
      return () => list.removeEventListener("change", notify);
    },
    () => typeof window.matchMedia === "function" && window.matchMedia(query).matches,
    () => false,
  );
}

export const PHONE_QUERY = `(max-width: ${PHONE_MAX_PX}px)`;
