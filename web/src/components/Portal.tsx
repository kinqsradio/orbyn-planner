import type { ReactNode } from "react";
import { createPortal } from "react-dom";

/** Renders outside the app root, so the root can be made inert while a modal dialog is open. */
export function Portal({ children }: { children: ReactNode }) {
  return createPortal(children, document.body);
}
