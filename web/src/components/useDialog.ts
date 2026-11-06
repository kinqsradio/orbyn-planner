import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Makes `ref` behave as a dialog: focus moves in (to `[data-autofocus]` if present), Tab
 * stays inside, Escape closes, and focus returns to where it was when the dialog goes away.
 */
export function useDialog(ref: RefObject<HTMLElement | null>, onClose: () => void): void {
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusables = () => Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE));
    (el.querySelector<HTMLElement>("[data-autofocus]") ?? focusables()[0] ?? el).focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close.current();
      } else if (event.key === "Tab") {
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
      if (opener?.isConnected) opener.focus();
    };
  }, [ref]);
}
