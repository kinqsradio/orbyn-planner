import { useMemo } from "react";
import { useNow } from "../../app/clock";
import { useUi } from "../../app/ui";
import { PageHeader } from "../../components/EmptyState";
import { Icon } from "../../components/Icon";
import { MONTHS, WEEKDAYS, dateKey, startOfDay } from "../../lib/dates";
import { usePlanner } from "../../store/context";
import { groupToday } from "../tasks/selectors";
import { TodayRow } from "../tasks/TaskRow";
import { SyncLine, useSyncStatus, withPersistence } from "../sync/SyncLine";

function greeting(now: Date): string {
  const h = now.getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export function TodayPage() {
  const { tasks, outbox, persistence } = usePlanner();
  const ui = useUi();
  const now = useNow();
  const waiting = useMemo(() => {
    const latest = new Map<string, string>();
    for (const e of outbox) if (e.type === "task") latest.set(e.id, e.updatedAt);
    return [...latest].flatMap(([id, at]) => {
      const task = tasks.find((t) => t.id === id);
      return task ? [{ id, label: task.title, at }] : [];
    });
  }, [outbox, tasks]);
  const { status: health, retry } = useSyncStatus(outbox.length);
  const status = withPersistence(health, persistence);
  const g = useMemo(() => groupToday(tasks, now), [tasks, now]);

  const todayOpen = g.today.filter((t) => !t.done).length;
  const planned = todayOpen + g.overdue.length;
  const empty = g.overdue.length === 0 && g.today.length === 0;
  const dayName = WEEKDAYS[now.getDay()]!;
  /** Whole days late, or undefined for a task that is only late today. */
  const lateDays = (due: string) => {
    const days = Math.round((startOfDay(now).getTime() - startOfDay(new Date(due.slice(0, 10) + "T00:00")).getTime()) / 86_400_000);
    return days >= 1 ? days : undefined;
  };
  const pct = g.weekTotal === 0 ? 0 : Math.round((g.doneThisWeek / g.weekTotal) * 100);

  return (
    <>
      <PageHeader title={greeting(now)} sub={`${dayName} ${now.getDate()} ${MONTHS[now.getMonth()]} · ${planned === 0 ? "nothing planned" : `${planned} ${planned === 1 ? "task" : "tasks"}`}`}>
        <SyncLine status={status} onRetry={retry} waiting={waiting} />
        <button type="button" className="btn" onClick={ui.openNewTask}>
          <Icon name="plus" small />
          New task
        </button>
      </PageHeader>

      <div className="grid4 today-stats" style={{ padding: "4px 28px 0" }}>
        <div className="stat"><small>Today</small><b>{todayOpen}</b></div>
        <div className="stat"><small>Overdue</small><b style={g.overdue.length > 0 ? { color: "var(--amber)" } : undefined}>{g.overdue.length}</b></div>
        <div className="stat"><small>This week</small><b>{g.thisWeekOpen}</b></div>
        <div className="stat"><small>Done this week</small><b>{g.doneThisWeek}</b></div>
      </div>

      <div className="cols">
        <div className="blk">
          <div className="bh">
            <b>Today</b>
            <span>{dayName.slice(0, 3)} {now.getDate()} {MONTHS[now.getMonth()]!.slice(0, 3)}</span>
          </div>
          {empty ? (
            <div className="empty">
              <h2>Nothing planned yet</h2>
              <p>Add a task to plan your day.</p>
            </div>
          ) : (
            <>
              {g.today.length > 0 && (
                <ul>
                  {g.today.map((t) => (
                    <TodayRow key={t.id} task={t} />
                  ))}
                </ul>
              )}
              {g.overdue.length > 0 && (
                <>
                  <div className="bh" style={{ paddingTop: 16 }}>
                    <b className="amber">Overdue</b>
                    <span>{g.overdue.length}</span>
                  </div>
                  <ul>
                    {g.overdue.map((t) => (
                      <TodayRow key={t.id} task={t} late={lateDays(t.due!)} />
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
        </div>

        <div className="blk aside">
          <div className="bh"><b>This week</b><span></span></div>
          <ul aria-label="The week at a glance">
            {g.week.map(({ date, tasks: due }) => (
              <li className="kv" key={dateKey(date)}>
                <span>{WEEKDAYS[date.getDay()]!.slice(0, 3)} {date.getDate()}</span>
                <b className={due.length === 0 ? "t3" : undefined}>
                  {due.length === 0 ? "Nothing planned" : due.length === 1 ? due[0]!.title : `${due.length} tasks`}
                </b>
              </li>
            ))}
          </ul>
          <div className="bh" style={{ paddingTop: 16 }}><b>Progress</b></div>
          <div className="kv"><span>Tasks done this week</span><b>{g.doneThisWeek} of {g.weekTotal}</b></div>
          <div className="meter" role="progressbar" aria-label="Tasks done this week" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><i style={{ width: `${pct}%` }} /></div>
        </div>
      </div>
    </>
  );
}
