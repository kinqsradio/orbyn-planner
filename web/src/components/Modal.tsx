import { useRef, type ReactNode } from "react";
import { Portal } from "./Portal";
import { useDialog } from "./useDialog";

/** A centred dialog on the auth card: Escape and a click outside close it. */
export function Modal({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useDialog(ref, onClose);
  return (
    <Portal>
      <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
        <div ref={ref} className="authcard" style={{ width: 440 }} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}>
          {children}
        </div>
      </div>
    </Portal>
  );
}
