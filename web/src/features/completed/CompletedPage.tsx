import { useState } from "react";
import { useNow } from "../../app/clock";
import { PageHeader } from "../../components/EmptyState";
import { formatDue, makeDue } from "../../lib/dates";
import { usePlanner, useStore } from "../../store/context";
import { RESTORE_DAYS } from "../../store/types";
import { Swatch, TaskRow } from "../tasks/TaskRow";

type Tab = "completed" | "deleted";

export function CompletedPage() {
  const store = useStore();
  const { tasks, lists } = usePlanner();
  const now = useNow();
  const [tab, setTab] = useState<Tab>("completed");

  const day = (iso: string | null) => (iso ? formatDue(makeDue(new Date(iso), false), now) : "");
  const completed = tasks
    .filter((t) => t.done && t.deletedAt === null)
    .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""));
  const deleted = tasks
    .filter((t) => t.deletedAt !== null)
    .sort((a, b) => (b.deletedAt ?? "").localeCompare(a.deletedAt ?? ""));

  return (
    <>
      <PageHeader title="Completed and deleted" />
      <div role="tablist" aria-label="Completed and deleted" className="tabs2">
        {(["completed", "deleted"] as const).map((id) => (
          <button key={id} type="button" role="tab" id={`tab-${id}`} aria-selected={tab === id} aria-controls="tab-panel" className={tab === id ? "tab2 on" : "tab2"} onClick={() => setTab(id)}>
            {id === "completed" ? "Completed" : "Deleted"}
          </button>
        ))}
      </div>

      <div role="tabpanel" id="tab-panel" aria-labelledby={`tab-${tab}`} className="tbl-wrap" style={{ paddingTop: "var(--sp-8)" }}>
        {tab === "completed" ? (
          completed.length === 0 ? (
            <p className="quiet note">Nothing completed yet. Tasks you finish will appear here.</p>
          ) : (
            <ul className="tbl">
              {completed.map((t) => (
                <TaskRow key={t.id} task={t} layout="completed" extra={day(t.completedAt)} />
              ))}
            </ul>
          )
        ) : deleted.length === 0 ? (
          <p className="quiet note">Nothing deleted. Deleted tasks stay here for {RESTORE_DAYS} days.</p>
        ) : (
          <ul className="tbl">
            {deleted.map((t) => {
              const list = lists.find((l) => l.id === t.listId);
              return (
                <li key={t.id} className="tr" style={{ gridTemplateColumns: "minmax(0,1fr) var(--sp-140) var(--sp-120) auto" }}>
                  <span className="tt">{t.title}</span>
                  <span>
                    {list && (
                      <span className="tag">
                        <Swatch colour={list.colour} />
                        {list.name}
                      </span>
                    )}
                  </span>
                  <span>{day(t.deletedAt)}</span>
                  <button type="button" className="ghost" aria-label={`Put back ${t.title}`} onClick={() => store.restoreTask(t.id)}>
                    Put back
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <p className="note t3" style={{ padding: "var(--sp-14) var(--sp-28)" }}>
        Deleted items: {deleted.length} · kept for {RESTORE_DAYS} days, then removed for good.
      </p>
    </>
  );
}
