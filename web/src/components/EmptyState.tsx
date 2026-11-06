import type { ReactNode } from "react";

export function EmptyState({ title, body, children }: { title: string; body: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <h2 className="empty-title">{title}</h2>
      <p className="empty-body">{body}</p>
      {children}
    </div>
  );
}

export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className="page-header">
      <h1 className="page-title">{title}</h1>
      {children}
    </header>
  );
}
