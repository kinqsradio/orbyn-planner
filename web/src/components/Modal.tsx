import { useRef, type ReactNode } from "react";
import { Portal } from "./Portal";
import { useDialog } from "./useDialog";

/** A centred dialog on the auth card: Escape and a click outside close it. */
export function Modal({ label, onClose, className, children }: { label: string; onClose: () => void; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useDialog(ref, onClose);
  return (
    <Portal>
      <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
        <div ref={ref} className={className ? `authcard ${className}` : "authcard"} style={{ width: "var(--sp-440)" }} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}>
          {children}
        </div>
      </div>
    </Portal>
  );
}
