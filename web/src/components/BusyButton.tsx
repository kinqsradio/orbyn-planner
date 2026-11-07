import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from "react";

/** The busy look shows only after this long: a quick answer never flashes a spinner. */
export const BUSY_AFTER_MS = 400;

/**
 * A button that says what it is doing: while `busy` it is disabled at once, and after 400 ms a small spinner and the busy label show
 * in it. Both labels take the same space, so the button keeps its width.
 */
export function BusyButton({ busy, idle, working, disabled, ...rest }: { busy: boolean; idle: ReactNode; working: ReactNode } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children">) {
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (!busy) return;
    const timer = setTimeout(() => setLate(true), BUSY_AFTER_MS);
    return () => {
      clearTimeout(timer);
      setLate(false);
    };
  }, [busy]);
  const showing = busy && late;
  return (
    <button type="button" {...rest} disabled={busy || disabled} aria-busy={busy || undefined}>
      <span className="busy-label">
        <span className="busy-idle" style={showing ? { visibility: "hidden" } : undefined}>{idle}</span>
        {showing && (
          <span className="busy-working">
            <span className="spin" aria-hidden="true" />
            {working}
          </span>
        )}
      </span>
    </button>
  );
}
