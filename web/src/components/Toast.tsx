import { useEffect, useRef, useState } from "react";
import { TOAST_MS, useUi, type ToastState } from "../app/ui";

/** One toast. Its timer waits while the pointer or focus is on it, so there is time to reach Undo. */
function ToastBody({ toast, dismiss }: { toast: ToastState; dismiss: () => void }) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const undo = useRef<HTMLButtonElement>(null);
  const paused = hovered || focused;

  useEffect(() => {
    if (paused) return;
    const timer = setTimeout(dismiss, TOAST_MS);
    return () => clearTimeout(timer);
  }, [paused, dismiss]);

  useEffect(() => {
    if (toast.focusUndo) undo.current?.focus();
  }, [toast.focusUndo]);

  return (
    <div
      className="toast"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    >
      <span>{toast.message}</span>
      {toast.undo && (
        <button
          ref={undo}
          type="button"
          className="toast-action"
          onClick={() => {
            toast.undo?.();
            dismiss();
          }}
        >
          Undo
        </button>
      )}
    </div>
  );
}

/** The live region stays mounted, so a screen reader hears each new message as it appears. */
export function Toast() {
  const { toast, dismissToast } = useUi();
  return (
    <div role="status" aria-live="polite" className="toast-live">
      {toast && <ToastBody key={toast.id} toast={toast} dismiss={dismissToast} />}
    </div>
  );
}
