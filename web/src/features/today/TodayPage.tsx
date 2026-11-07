import { useCallback, useEffect, useMemo, useState } from "react";
import { useNow } from "../../app/clock";
import { useRouter } from "../../app/router";
import { useUi } from "../../app/ui";
import { useAuth } from "../../auth/AuthProvider";
import { PHONE_QUERY, useMediaQuery } from "../../components/useMediaQuery";
import { motionMs } from "../../styles/tokens";
import { projectStats } from "../projects/stats";
import { PageHeader } from "../../components/EmptyState";
import { Icon } from "../../components/Icon";
import { MONTHS, WEEKDAYS, addDays, dateKey, formatDue, formatTime, parseDue, startOfDay } from "../../lib/dates";
import { daysBetween, lastDayOf, touchesDay } from "../../lib/wall";
import { usePlanner } from "../../store/context";
import { expandEvents, type Occurrence } from "../../store/occurrences";
import { colourOf } from "../calendar/TimeGrid";
import { groupToday } from "../tasks/selectors";
import type { Task } from "../../store/types";
import { TodayRow } from "../tasks/TaskRow";
import { SyncLine, useSyncStatus, withPersistence } from "../sync/SyncLine";
import { useSyncController, useSyncState } from "../../sync/SyncProvider";

/** Morning is 05:00 to 11:59, afternoon 12:00 to 17:59 and evening 18:00 to 04:59, by the local clock. */
export function greetingAt(now: Date): string {
  const h = now.getHours();
  return h >= 5 && h < 12 ? "Good morning" : h >= 12 && h < 18 ? "Good afternoon" : "Good evening";
}

const countWords = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** True once `active` has lasted 400 ms: a quick load never flashes a skeleton. */
function useSlow(active: boolean): boolean {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => setSlow(true), motionMs("wait"));
    return () => {
      clearTimeout(timer);
      setSlow(false);
    };
  }, [active]);
  return active && slow;
}

function EventRow({ occ, day, phone }: { occ: Occurrence; day: string; phone: boolean }) {
  const { calendars } = usePlanner();
  const ui = useUi();
  const calendar = calendars.find((c) => c.id === occ.event.calendarId);
  // An all-day event names its calendar; a timed one says it is an event, and where.
  const total = daysBetween(occ.date, lastDayOf(occ.start, occ.end, occ.allDay)) + 1;
  const title = occ.allDay && total > 1 ? `${occ.event.title} · day ${daysBetween(occ.date, day) + 1} of ${total}` : occ.event.title;
  const meta = phone ? "" : occ.allDay ? (calendar?.name ?? "") : ["Event", occ.event.place].filter(Boolean).join(" · ");
  return (
    <li className="row" data-row-id={occ.event.id}>
      <span className="time">{occ.allDay ? "All day" : formatTime(parseDue(occ.start).date)}</span>
      <span className="sw" style={{ background: colourOf(calendars, occ.event) }} aria-hidden="true" />
      <button type="button" className="what link-btn" onClick={() => ui.openEvent(occ.event.id, occ.date)}>{title}</button>
      <span className="meta">{meta}</span>
    </li>
  );
}

type Entry = { kind: "task"; task: Task } | { kind: "event"; occ: Occurrence };

/** Timed events and tasks together in time order, then the day's tasks with no time, then finished ones. */
function inTimeOrder(entries: Entry[]): Entry[] {
  const rank = (e: Entry): [number, string] => {
    if (e.kind === "event") return [0, e.occ.start.slice(11, 16)];
    if (e.task.done) return [2, ""];
    return e.task.due && e.task.due.length > 10 ? [0, e.task.due.slice(11, 16)] : [1, ""];
  };
  return [...entries].sort((a, b) => {
    const [ra, ta] = rank(a);
    const [rb, tb] = rank(b);
    return ra - rb || ta.localeCompare(tb);
  });
}

/** What the week column says of one day: the one item by name (an event with its time), or the counts. */
function dayLabel(tasks: Task[], events: Occurrence[]): string {
  const total = tasks.length + events.length;
  if (total === 0) return "Nothing planned";
  if (total === 1) {
    if (tasks[0]) return tasks[0].title;
    const o = events[0]!;
    return o.allDay ? o.event.title : `${o.event.title} ${formatTime(parseDue(o.start).date)}`;
  }
  return [tasks.length > 0 && countWords(tasks.length, "task", "tasks"), events.length > 0 && countWords(events.length, "event", "events")].filter(Boolean).join(" · ");
}

export function TodayPage() {
  const { tasks, outbox, persistence, events, calendars, projects, ready } = usePlanner();
  const ui = useUi();
  const { navigate } = useRouter();
  const auth = useAuth();
  const phone = useMediaQuery(PHONE_QUERY);
  const [weekOpen, setWeekOpen] = useState(false);
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
  const skeleton = useSlow(!ready);

  const shownEvents = useMemo(() => {
    const visible = new Set(calendars.filter((c) => c.visible).map((c) => c.id));
    return events.filter((e) => visible.has(e.calendarId));
  }, [events, calendars]);
  const key = dateKey(now);
  const todayEvents = useMemo(() => expandEvents(shownEvents, key, key), [shownEvents, key]);
  const allDay = useMemo(() => todayEvents.filter((o) => o.allDay), [todayEvents]);
  const entries = useMemo(
    () => inTimeOrder([...g.today.map((task): Entry => ({ kind: "task", task })), ...todayEvents.filter((o) => !o.allDay).map((occ): Entry => ({ kind: "event", occ }))]),
    [g.today, todayEvents],
  );

  const weekEvents = useMemo(() => expandEvents(shownEvents, dateKey(g.week[0]!.date), dateKey(g.week.at(-1)!.date)), [shownEvents, g.week]);
  const week = useMemo(
    () =>
      g.week.map(({ date, tasks: due }) => {
        const k = dateKey(date);
        const evs = weekEvents.filter((o) => touchesDay(o, k));
        return { date, key: k, label: dayLabel(due, evs), total: due.length + evs.length };
      }),
    [g.week, weekEvents],
  );
  const comingUp = week.reduce((n, d) => n + d.total, 0);

  // Up to three projects with a goal in the next 30 days, nearest first; none, and Progress is not shown.
  const progress = useMemo(() => {
    const last = dateKey(addDays(startOfDay(now), 30));
    return projects
      .filter((p) => !p.archived && p.goal !== null && p.goal.slice(0, 10) >= key && p.goal.slice(0, 10) <= last)
      .sort((a, b) => a.goal!.localeCompare(b.goal!))
      .slice(0, 3)
      .map((p) => ({ project: p, percent: projectStats(tasks, p.id).percent }));
  }, [projects, tasks, now, key]);

  const todayOpen = g.today.filter((t) => !t.done).length;
  const itemCount = todayEvents.length + g.today.length;
  const dayName = WEEKDAYS[now.getDay()]!;
  const first = auth?.session?.name?.trim().split(/\s+/)[0];
  const title = phone ? "Today" : first ? `${greetingAt(now)}, ${first}` : greetingAt(now);
  // The header counts everything scheduled or due today, done included.
  const summary =
    itemCount === 0
      ? "nothing planned"
      : phone
        ? countWords(itemCount, "item", "items")
        : [todayEvents.length > 0 && countWords(todayEvents.length, "event", "events"), g.today.length > 0 && countWords(g.today.length, "task", "tasks")].filter(Boolean).join(", ");
  /** Whole days late, or undefined for a task that is only late today. */
  const lateDays = (due: string) => {
    const days = Math.round((startOfDay(now).getTime() - startOfDay(new Date(due.slice(0, 10) + "T00:00")).getTime()) / 86_400_000);
    return days >= 1 ? days : undefined;
  };
  const empty = g.overdue.length === 0 && itemCount === 0;
  const dateLabel = `${dayName.slice(0, 3)} ${now.getDate()} ${MONTHS[now.getMonth()]!.slice(0, 3)}`;

  const rows = (list: Entry[]) =>
    list.map((e) => (e.kind === "task" ? <TodayRow key={e.task.id} task={e.task} /> : <EventRow key={`${e.occ.event.id}-${e.occ.date}`} occ={e.occ} day={key} phone={phone} />));

  const weekList = (
    <ul aria-label="The week at a glance">
      {week.map((d) => (
        <li className="kv" key={d.key}>
          <span>{WEEKDAYS[d.date.getDay()]!.slice(0, 3)} {d.date.getDate()}</span>
          <b className={d.total === 0 ? "t3" : undefined}>{d.label}</b>
        </li>
      ))}
    </ul>
  );

  const loadingRows = (n: number) => Array.from({ length: n }, (_, i) => (
    <li className="row" key={i}>
      <span className="time"><span className="skel" /></span>
      <span className="sw" aria-hidden="true" />
      <span className="what"><span className="skel" /></span>
      <span className="meta"><span className="skel" /></span>
    </li>
  ));

  if (!ready) {
    return (
      <>
        <PageHeader title={title} sub={skeleton ? undefined : undefined}>
          {skeleton && <span role="status" className="t3"><span className="spin" aria-hidden="true" />Loading today</span>}
          <button type="button" className="btn" disabled><Icon name="plus" small />New task</button>
        </PageHeader>
        <div className="grid4 today-stats" style={{ padding: "var(--sp-4) var(--sp-28) 0" }}>
          {["Today", "Overdue", "Coming up", "Done today"].map((l) => (
            <div className="stat" key={l}><small>{l}</small><b>{skeleton && <span className="skel" />}</b></div>
          ))}
        </div>
        <div className="cols">
          <div className="blk" aria-busy="true"><div className="bh"><b>Today</b><span></span></div>{skeleton && <ul>{loadingRows(6)}</ul>}</div>
          <div className="blk aside"><div className="bh"><b>This week</b><span></span></div></div>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader title={title} sub={`${dayName} ${now.getDate()} ${MONTHS[now.getMonth()]} · ${summary}`}>
        <SyncLine status={status} onRetry={retry} waiting={waiting} />
        <button type="button" className="btn" onClick={() => ui.openNewTask()}>
          <Icon name="plus" small />
          New task
        </button>
      </PageHeader>

      <div className="grid4 today-stats" style={{ padding: "var(--sp-4) var(--sp-28) 0" }}>
        <div className="stat"><small>Today</small><b>{todayOpen + todayEvents.length}</b></div>
        <div className="stat"><small>Overdue</small><b style={g.overdue.length > 0 ? { color: "var(--amber-text)" } : undefined}>{g.overdue.length}</b></div>
        <div className="stat"><small>Coming up</small><b>{comingUp}</b></div>
        <div className="stat"><small>Done today</small><b>{g.doneToday}</b></div>
      </div>

      <div className="cols">
        <div className="blk">
          <div className="bh">
            <b>Today</b>
            <span>{dateLabel}</span>
          </div>
          {empty ? (
            <div className="empty">
              <h2>{phone ? "A clear day" : "Nothing planned today"}</h2>
              <p>{phone ? "No events or tasks today. Add one, or look at the week." : "No events or tasks. Add one, or look at the week."}</p>
              {phone ? (
                <div className="empty-actions">
                  <button type="button" className="ghost lg" onClick={() => navigate("/calendar")}>Open the week</button>
                  <button type="button" className="btn lg" onClick={() => ui.openNewTask()}><Icon name="plus" small />Add a task</button>
                </div>
              ) : (
                <button type="button" className="btn" onClick={() => ui.openNewTask()}><Icon name="plus" small />Add a task</button>
              )}
            </div>
          ) : (
            <div className="today-list">
              {allDay.length > 0 && (
                <>
                  <div className="bh"><b>All day</b><span>{allDay.length}</span></div>
                  <ul>{allDay.map((occ) => <EventRow key={`${occ.event.id}-${occ.date}`} occ={occ} day={key} phone={phone} />)}</ul>
                  {entries.length > 0 && <div className="bh"><b>Timed</b><span></span></div>}
                </>
              )}
              {entries.length > 0 && <ul>{rows(entries)}</ul>}
              {g.overdue.length > 0 && (
                <>
                  <div className="bh" style={{ paddingTop: "var(--sp-16)" }}>
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
            </div>
          )}
          {phone && (
            <div className="week-fold">
              <button type="button" className="kv link-btn" aria-expanded={weekOpen} onClick={() => setWeekOpen(!weekOpen)}>
                <span>This week</span>
                <b>{countWords(comingUp, "item", "items")}</b>
              </button>
              {weekOpen && weekList}
            </div>
          )}
        </div>

        {!phone && (
        <div className="blk aside">
          <div className="bh"><b>This week</b><span></span></div>
          {weekList}
          {progress.length > 0 && (
            <>
              <div className="bh" style={{ paddingTop: "var(--sp-16)" }}><b>Progress</b><span></span></div>
              {progress.map(({ project, percent }) => (
                <div key={project.id}>
                  <div className="kv"><span>{project.name}</span><b>{percent}% · goal {project.goal!.slice(0, 10) === key ? "today" : formatDue(project.goal!, now).toLowerCase()}</b></div>
                  <div className="meter" role="progressbar" aria-label={`${project.name} progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><i style={{ width: `${percent}%` }} /></div>
                </div>
              ))}
            </>
          )}
        </div>
        )}
      </div>
    </>
  );
}
