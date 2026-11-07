import type { ReactNode } from "react";

/** A calm empty state with one next action. */
export function EmptyState({ title, body, children }: { title: string; body: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <h2>{title}</h2>
      <p>{body}</p>
      {children}
    </div>
  );
}

/** The sheet header: title, a quiet sub line and actions at the right. */
export function PageHeader({ title, sub, children }: { title: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="ph">
      <h1>{title}</h1>
      {sub && <span className="sub">{sub}</span>}
      {children && <div className="acts">{children}</div>}
    </div>
  );
}
