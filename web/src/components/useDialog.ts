import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

let locks = 0;
let savedOverflow = "";

/** While a modal dialog is open the app behind it cannot be reached or scrolled. */
function lockBackground(): () => void {
  const root = () => document.getElementById("root");
  if (locks++ === 0) {
    root()?.setAttribute("inert", "");
    savedOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  return () => {
    if (--locks === 0) {
      root()?.removeAttribute("inert");
      document.body.style.overflow = savedOverflow;
    }
  };
}

/**
 * Makes `ref` behave as a dialog: focus moves in (to `[data-autofocus]` if present), Tab
 * stays inside (unless `trap` is false), Escape closes, a modal one also locks scrolling and makes the
 * app root inert (it must be rendered in a Portal, outside the root), and focus returns to where it was when the dialog goes away.
 */
export function useDialog(ref: RefObject<HTMLElement | null>, onClose: () => void, trap = true, modal = trap): void {
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const unlock = modal ? lockBackground() : () => undefined;
    const focusables = () => Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE));
    (el.querySelector<HTMLElement>("[data-autofocus]") ?? focusables()[0] ?? el).focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close.current();
      } else if (event.key === "Tab" && trap) {
        const items = focusables();
        const first = items[0];
        const last = items[items.length - 1];
        if (!first || !last) {
          event.preventDefault();
        } else if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    el.addEventListener("keydown", onKey);
    return () => {
      el.removeEventListener("keydown", onKey);
      unlock();
      if (opener?.isConnected) opener.focus();
    };
  }, [ref, trap, modal]);
}
