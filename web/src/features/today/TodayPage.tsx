import { Plus } from "lucide-react";
import { useMemo } from "react";
import { useNow } from "../../app/clock";
import { EmptyState, PageHeader } from "../../components/EmptyState";
import { WEEKDAYS } from "../../lib/dates";
import { usePlanner } from "../../store/context";
import { groupToday } from "../tasks/selectors";
import { TaskRow } from "../tasks/TaskRow";
import { SyncLine, useSyncStatus } from "../sync/SyncLine";

export function TodayPage() {
  const { tasks, outbox } = usePlanner();
  const now = useNow();
  const { status, retry } = useSyncStatus(outbox.length);
  const groups = useMemo(() => groupToday(tasks, now), [tasks, now]);
  const empty = groups.overdue.length === 0 && groups.today.length === 0;

  return (
    <>
      <PageHeader title="Today">
        <SyncLine status={status} onRetry={retry} />
      </PageHeader>

      {empty ? (
        <EmptyState title="Nothing planned yet" body="Add a task to plan your day.">
          <button type="button" className="btn btn-primary" disabled title="Adding tasks arrives in the next phase">
            <Plus size={16} aria-hidden="true" />
            New task
          </button>
        </EmptyState>
      ) : (
        <>
          {groups.overdue.length > 0 && (
            <section aria-labelledby="overdue-h" className="today-group">
              <h2 id="overdue-h" className="section-title due-act">Overdue</h2>
              <ul className="task-list">
                {groups.overdue.map((t) => (
                  <TaskRow key={t.id} task={t} />
                ))}
              </ul>
            </section>
          )}
          {groups.today.length > 0 && (
            <section aria-labelledby="today-h" className="today-group">
              <h2 id="today-h" className="section-title">Today</h2>
              <ul className="task-list">
                {groups.today.map((t) => (
                  <TaskRow key={t.id} task={t} />
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      <div className="today-side">
        <section aria-labelledby="week-h">
          <h2 id="week-h" className="section-title">The week at a glance</h2>
          <ul className="week">
            {groups.week.map(({ date, count }) => (
              <li key={date.toISOString()} className="week-day">
                <span className="meta-text">{WEEKDAYS[date.getDay()]!.slice(0, 3)} {date.getDate()}</span>
                <span className="week-count" aria-label={`${count} ${count === 1 ? "task" : "tasks"}`}>{count}</span>
              </li>
            ))}
          </ul>
        </section>
        <section aria-labelledby="done-h" className="stat">
          <h2 id="done-h" className="section-title">Done this week</h2>
          <p className="stat-value">{groups.doneThisWeek}</p>
        </section>
      </div>
    </>
  );
}
