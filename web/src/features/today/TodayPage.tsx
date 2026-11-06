import { useCallback, useMemo } from "react";
import { useNow } from "../../app/clock";
import { useUi } from "../../app/ui";
import { PageHeader } from "../../components/EmptyState";
import { Icon } from "../../components/Icon";
import { MONTHS, WEEKDAYS, dateKey, formatTime, parseDue, startOfDay } from "../../lib/dates";
import { touchesDay } from "../../lib/wall";
import { usePlanner } from "../../store/context";
import { expandEvents, type Occurrence } from "../../store/occurrences";
import { colourOf } from "../calendar/TimeGrid";
import { groupToday } from "../tasks/selectors";
import type { Task } from "../../store/types";
import { TodayRow } from "../tasks/TaskRow";
import { SyncLine, useSyncStatus, withPersistence } from "../sync/SyncLine";
import { useSyncController, useSyncState } from "../../sync/SyncProvider";

function greeting(now: Date): string {
  const h = now.getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

function EventRow({ occ }: { occ: Occurrence }) {
  const { calendars } = usePlanner();
  const ui = useUi();
  const meta = ["Event", occ.event.place].filter(Boolean).join(" · ");
  return (
    <li className="row" data-row-id={occ.event.id}>
      <span className="time">{occ.allDay ? "All day" : formatTime(parseDue(occ.start).date)}</span>
      <span className="sw" style={{ background: colourOf(calendars, occ.event) }} aria-hidden="true" />
      <button type="button" className="what link-btn" onClick={() => ui.openEvent(occ.event.id, occ.date)}>{occ.event.title}</button>
      <span className="meta">{meta}</span>
    </li>
  );
}

type Entry = { kind: "task"; task: Task } | { kind: "event"; occ: Occurrence };

/** Time order: timed events and tasks together, then all-day events, then tasks for the day, then finished ones. */
function inTimeOrder(entries: Entry[]): Entry[] {
  const rank = (e: Entry): [number, string] => {
    if (e.kind === "event") return e.occ.allDay ? [1, ""] : [0, e.occ.start.slice(11, 16)];
    if (e.task.done) return [3, ""];
    return e.task.due && e.task.due.length > 10 ? [0, e.task.due.slice(11, 16)] : [2, ""];
  };
  return [...entries].sort((a, b) => {
    const [ra, ta] = rank(a);
    const [rb, tb] = rank(b);
    return ra - rb || ta.localeCompare(tb);
  });
}

export function TodayPage() {
  const { tasks, outbox, persistence, events, calendars } = usePlanner();
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
  const sync = useSyncState();
  const controller = useSyncController();
  const syncNow = useCallback(() => controller?.syncNow(), [controller]);
  const { status: health, retry } = useSyncStatus(outbox.length, sync, syncNow);
  const status = withPersistence(health, persistence);
  const g = useMemo(() => groupToday(tasks, now), [tasks, now]);

  const shownEvents = useMemo(() => {
    const visible = new Set(calendars.filter((c) => c.visible).map((c) => c.id));
    return events.filter((e) => visible.has(e.calendarId));
  }, [events, calendars]);
  const key = dateKey(now);
  const todayEvents = useMemo(() => expandEvents(shownEvents, key, key), [shownEvents, key]);
  const entries = useMemo(
    () => inTimeOrder([...g.today.map((task): Entry => ({ kind: "task", task })), ...todayEvents.map((occ): Entry => ({ kind: "event", occ }))]),
    [g.today, todayEvents],
  );

  const weekEvents = useMemo(() => expandEvents(shownEvents, dateKey(g.week[0]!.date), dateKey(g.week.at(-1)!.date)), [shownEvents, g.week]);

  const todayOpen = g.today.filter((t) => !t.done).length;
  const planned = todayOpen + g.overdue.length;
  const empty = g.overdue.length === 0 && entries.length === 0;
  const countWords = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const summary =
    planned + todayEvents.length === 0
      ? "nothing planned"
      : [todayEvents.length > 0 && countWords(todayEvents.length, "event", "events"), planned > 0 && countWords(planned, "task", "tasks")].filter(Boolean).join(", ");
  const dayName = WEEKDAYS[now.getDay()]!;
  /** Whole days late, or undefined for a task that is only late today. */
  const lateDays = (due: string) => {
    const days = Math.round((startOfDay(now).getTime() - startOfDay(new Date(due.slice(0, 10) + "T00:00")).getTime()) / 86_400_000);
    return days >= 1 ? days : undefined;
  };
  const pct = g.weekTotal === 0 ? 0 : Math.round((g.doneThisWeek / g.weekTotal) * 100);

  return (
    <>
      <PageHeader title={greeting(now)} sub={`${dayName} ${now.getDate()} ${MONTHS[now.getMonth()]} · ${summary}`}>
        <SyncLine status={status} onRetry={retry} waiting={waiting} />
        <button type="button" className="btn" onClick={() => ui.openNewTask()}>
          <Icon name="plus" small />
          New task
        </button>
      </PageHeader>

      <div className="grid4 today-stats" style={{ padding: "4px 28px 0" }}>
        <div className="stat"><small>Today</small><b>{todayOpen + todayEvents.length}</b></div>
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
              {entries.length > 0 && (
                <ul>
                  {entries.map((e) =>
                    e.kind === "task" ? <TodayRow key={e.task.id} task={e.task} /> : <EventRow key={`${e.occ.event.id}-${e.occ.date}`} occ={e.occ} />,
                  )}
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
            {g.week.map(({ date, tasks: due }) => {
              const k = dateKey(date);
              const evs = weekEvents.filter((o) => touchesDay(o, k));
              const total = due.length + evs.length;
              const label =
                total === 0
                  ? "Nothing planned"
                  : total === 1
                    ? (due[0]?.title ?? evs[0]!.event.title)
                    : [due.length > 0 && countWords(due.length, "task", "tasks"), evs.length > 0 && countWords(evs.length, "event", "events")].filter(Boolean).join(" · ");
              return (
                <li className="kv" key={k}>
                  <span>{WEEKDAYS[date.getDay()]!.slice(0, 3)} {date.getDate()}</span>
                  <b className={total === 0 ? "t3" : undefined}>{label}</b>
                </li>
              );
            })}
          </ul>
          <div className="bh" style={{ paddingTop: 16 }}><b>Progress</b></div>
          <div className="kv"><span>Tasks done this week</span><b>{g.doneThisWeek} of {g.weekTotal}</b></div>
          <div className="meter" role="progressbar" aria-label="Tasks done this week" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><i style={{ width: `${pct}%` }} /></div>
        </div>
      </div>
    </>
  );
}
