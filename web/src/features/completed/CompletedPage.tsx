import { useState } from "react";
import { useNow } from "../../app/clock";
import { Link } from "../../app/router";
import { EmptyState, PageHeader } from "../../components/EmptyState";
import { formatDue } from "../../lib/dates";
import { usePlanner, useStore } from "../../store/context";
import { RESTORE_DAYS } from "../../store/types";
import { TaskRow } from "../tasks/TaskRow";

type Tab = "completed" | "deleted";

export function CompletedPage() {
  const store = useStore();
  const { tasks } = usePlanner();
  const now = useNow();
  const [tab, setTab] = useState<Tab>("completed");

  const completed = tasks
    .filter((t) => t.done && t.deletedAt === null)
    .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""));
  const deleted = tasks
    .filter((t) => t.deletedAt !== null)
    .sort((a, b) => (b.deletedAt ?? "").localeCompare(a.deletedAt ?? ""));

  return (
    <>
      <PageHeader title="Completed and deleted">
        <Link to="/tasks" className="link-quiet">Back to tasks</Link>
      </PageHeader>
      <div role="tablist" aria-label="Completed and deleted" className="segmented">
        {(["completed", "deleted"] as const).map((id) => (
          <button key={id} type="button" role="tab" id={`tab-${id}`} aria-selected={tab === id} aria-controls="tab-panel" className="segment" onClick={() => setTab(id)}>
            {id === "completed" ? "Completed" : "Deleted"}
          </button>
        ))}
      </div>

      <div role="tabpanel" id="tab-panel" aria-labelledby={`tab-${tab}`} className="tab-panel">
        {tab === "completed" ? (
          completed.length === 0 ? (
            <EmptyState title="Nothing completed yet" body="Tasks you finish will appear here." />
          ) : (
            <ul className="task-list">
              {completed.map((t) => (
                <TaskRow key={t.id} task={t} />
              ))}
            </ul>
          )
        ) : deleted.length === 0 ? (
          <EmptyState title="Nothing deleted" body={`Deleted tasks stay here for ${RESTORE_DAYS} days.`} />
        ) : (
          <>
            <p className="meta-text tab-note">Deleted tasks are removed for good after {RESTORE_DAYS} days.</p>
            <ul className="task-list">
              {deleted.map((t) => (
                <li key={t.id} className="task-row">
                  <span className="task-title static">{t.title}</span>
                  <span className="task-meta">
                    {t.due && <span className="meta-text">{formatDue(t.due, now)}</span>}
                    <button type="button" className="btn btn-soft" aria-label={`Put back ${t.title}`} onClick={() => store.restoreTask(t.id)}>
                      Put back
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </>
  );
}
