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
import { MONTHS, WEEKDAYS, addDays, dateKey, formatTime, isDueToday, parseDue, startOfDay } from "../../lib/dates";
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

/** "goal today", "goal tomorrow", "goal Wednesday" (the next six days), "goal 14 Nov"; and backwards: "goal yesterday", the weekday, the date. */
export function goalLabel(goal: string, now: Date): string {
  const date = parseDue(goal).date;
  const diff = Math.round((startOfDay(date).getTime() - startOfDay(now).getTime()) / 86_400_000);
  if (diff === 0) return "goal today";
  if (diff === 1) return "goal tomorrow";
  if (diff === -1) return "goal yesterday";
  if (Math.abs(diff) <= 6) return `goal ${WEEKDAYS[date.getDay()]}`;
  return `goal ${date.getDate()} ${MONTHS[date.getMonth()]!.slice(0, 3)}`;
}

/** Shown in place of the lists only when the planner on this device can't be read, which the store does not report yet, so Today does not render it. */
export function TodayError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="card red-ring" role="alert">
      <span className="line"><span className="pv-red"><Icon name="alert" small /></span><b>Couldn’t open your planner on this device.</b></span>
      <span className="t3">Nothing was changed. Your other devices still have everything.</span>
      <span><button type="button" className="btn" onClick={onRetry}>Try again</button></span>
    </div>
  );
}

const countWords = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The first rows of a long list are laid out at once; the rest follow a few at a time, a frame apart, so the page paints before a thousand rows are laid out. */
const FIRST_ROWS = 40;
const ROWS_PER_FRAME = 60;
function useProgressive(total: number): number {
  const [shown, setShown] = useState(FIRST_ROWS);
  useEffect(() => {
    if (shown >= total) return;
    const frame = requestAnimationFrame(() => setShown((n) => n + ROWS_PER_FRAME));
    return () => cancelAnimationFrame(frame);
  }, [shown, total]);
  return Math.min(shown, total);
}

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

/** Where a row stands in a list drawn in steps, for a screen reader; a list that fits in the first rows needs no such thing. */
const place = (index: number, of: number) => (of > FIRST_ROWS ? { index, of } : undefined);

const clock = (iso: string) => formatTime(parseDue(iso).date);

/** A timed event that began before today and ends after it fills the whole day, so it sits in the All day group like a multi-day event. */
const coversDay = (o: Occurrence, day: string) => !o.allDay && o.start.slice(0, 10) < day && lastDayOf(o.start, o.end, false) > day;

function EventRow({ occ, day, phone, at }: { occ: Occurrence; day: string; phone: boolean; at?: { index: number; of: number } }) {
  const { calendars } = usePlanner();
  const ui = useUi();
  const calendar = calendars.find((c) => c.id === occ.event.calendarId);
  // An all-day event names its calendar; a timed one says it is an event, and where.
  const total = daysBetween(occ.date, lastDayOf(occ.start, occ.end, occ.allDay)) + 1;
  const title = occ.allDay && total > 1 ? `${occ.event.title} · day ${daysBetween(occ.date, day) + 1} of ${total}` : occ.event.title;
  // A timed event that began on an earlier day and is still going reads "Until 06:00" (it sorts as if it began at 00:00); one that begins
  // today and runs past midnight keeps its start and says when it ends.
  const startedEarlier = !occ.allDay && occ.start.slice(0, 10) < day;
  const endsLater = !occ.allDay && lastDayOf(occ.start, occ.end, false) > day;
  const dayWord = (d: string) => (daysBetween(day, d) === 1 ? "tomorrow" : daysBetween(day, d) === -1 ? "yesterday" : `${WEEKDAYS[parseDue(d).date.getDay()]!.slice(0, 3)} ${parseDue(d).date.getDate()} ${MONTHS[parseDue(d).date.getMonth()]!.slice(0, 3)}`);
  const covers = coversDay(occ, day);
  const time = occ.allDay || covers ? "All day" : startedEarlier ? `Until ${clock(occ.end)}` : clock(occ.start);
  let meta = occ.allDay ? (calendar?.name ?? "") : ["Event", occ.event.place].filter(Boolean).join(" · ");
  const range = (d: string) => `${WEEKDAYS[parseDue(d).date.getDay()]!.slice(0, 3)} ${parseDue(d).date.getDate()} ${MONTHS[parseDue(d).date.getMonth()]!.slice(0, 3)}`;
  if (covers) meta = `${range(occ.start.slice(0, 10))} – ${range(lastDayOf(occ.start, occ.end, false))}`;
  else if (startedEarlier) meta = `Started ${dayWord(occ.start.slice(0, 10))} ${clock(occ.start)}`;
  else if (endsLater) {
    // One day on: "Until 06:00 tomorrow"; further: "Until Fri 13 Nov 06:00".
    const last = lastDayOf(occ.start, occ.end, false);
    meta = daysBetween(day, last) === 1 ? `Until ${clock(occ.end)} tomorrow` : `Until ${range(last)} ${clock(occ.end)}`;
  }
  if (phone) meta = "";
  return (
    <li className="row" data-row-id={occ.event.id} {...(at ? { "aria-posinset": at.index + 1, "aria-setsize": at.of } : {})}>
      <span className="time">{time}</span>
      <span className="sw" style={{ background: colourOf(calendars, occ.event) }} aria-hidden="true" />
      <button type="button" className="what link-btn" onClick={() => ui.openEvent(occ.event.id, occ.date)}>{title}</button>
      <span className="meta">{meta}</span>
    </li>
  );
}

type Entry = { kind: "task"; task: Task } | { kind: "event"; occ: Occurrence };

/** Timed events and tasks together in time order, then the day's tasks with no time, then finished ones. */
function inTimeOrder(entries: Entry[], day: string): Entry[] {
  const rank = (e: Entry): [number, string] => {
    // An event still going from an earlier day sorts as if it began at 00:00.
    if (e.kind === "event") return [0, e.occ.start.slice(0, 10) < day ? "00:00" : e.occ.start.slice(11, 16)];
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
  const clockNow = useNow();
  // Everything below reads the day and the time to the minute, so the page is worked out once a minute, not on every render (the
  // rows of a long list arrive a frame at a time, and each step renders again).
  const minute = Math.floor(clockNow.getTime() / 60_000);
  const now = useMemo(() => new Date(minute * 60_000), [minute]);
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
  const lateRows = useProgressive(g.overdue.length);

  const shownEvents = useMemo(() => {
    const visible = new Set(calendars.filter((c) => c.visible).map((c) => c.id));
    return events.filter((e) => visible.has(e.calendarId));
  }, [events, calendars]);
  const key = dateKey(now);
  const todayEvents = useMemo(() => expandEvents(shownEvents, key, key), [shownEvents, key]);
  // By start, then a multi-day event before a single-day one, then by title.
  const allDay = useMemo(() => {
    const span = (o: Occurrence) => daysBetween(o.date, lastDayOf(o.start, o.end, o.allDay));
    return todayEvents.filter((o) => o.allDay || coversDay(o, key)).sort((a, b) => a.start.localeCompare(b.start) || Number(span(b) > 0) - Number(span(a) > 0) || a.event.title.localeCompare(b.event.title));
  }, [todayEvents, key]);
  const entries = useMemo(
    () => inTimeOrder([...g.today.map((task): Entry => ({ kind: "task", task })), ...todayEvents.filter((o) => !o.allDay && !coversDay(o, key)).map((occ): Entry => ({ kind: "event", occ }))], key),
    [g.today, todayEvents, key],
  );

  const entryRows = useProgressive(entries.length);
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
  // The header counts everything scheduled or due today, done included, and a task whose time has already passed today is still today's.
  const lateToday = g.overdue.filter((t) => isDueToday(t.due!, now)).length;
  const todayTasks = g.today.length + lateToday;
  // The Today number is what is still to come: an event that has ended no longer counts.
  const eventsToCome = todayEvents.filter((o) => o.allDay || parseDue(o.end).date.getTime() > now.getTime()).length;
  const itemCount = todayEvents.length + todayTasks;
  const dayName = WEEKDAYS[now.getDay()]!;
  const first = auth?.session?.name?.trim().split(/\s+/)[0];
  const title = phone ? "Today" : first ? `${greetingAt(now)}, ${first}` : greetingAt(now);
  // The header counts everything scheduled or due today, done included.
  const summary =
    itemCount === 0
      ? "nothing planned"
      : phone
        ? countWords(itemCount, "item", "items")
        : [todayEvents.length > 0 && countWords(todayEvents.length, "event", "events"), todayTasks > 0 && countWords(todayTasks, "task", "tasks")].filter(Boolean).join(", ");
  /** Whole days late, or undefined for a task that is only late today. */
  const lateDays = (due: string) => {
    const days = Math.round((startOfDay(now).getTime() - startOfDay(new Date(due.slice(0, 10) + "T00:00")).getTime()) / 86_400_000);
    return days >= 1 ? days : undefined;
  };
  const empty = g.overdue.length === 0 && itemCount === 0;
  const dateLabel = `${dayName.slice(0, 3)} ${now.getDate()} ${MONTHS[now.getMonth()]!.slice(0, 3)}`;

  // Only while the device is offline do rows say their change has not left it (as the designs draw it).
  const unsynced = new Set(status.kind === "offline" ? waiting.map((w) => w.id) : []);
  const rows = (list: Entry[], of: number) =>
    list.map((e, i) => (e.kind === "task" ? <TodayRow key={e.task.id} task={e.task} unsynced={unsynced.has(e.task.id)} at={place(i, of)} /> : <EventRow key={`${e.occ.event.id}-${e.occ.date}`} occ={e.occ} day={key} phone={phone} at={place(i, of)} />));

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
        <PageHeader title={title} sub={skeleton ? <span className="skel" style={{ width: "var(--sp-200)" }} /> : undefined}>
          {skeleton && <span role="status" className="t3"><span className="spin" aria-hidden="true" />Loading today</span>}
          <button type="button" className="btn" disabled><Icon name="plus" small />New task</button>
        </PageHeader>
        <div className="grid4 today-stats" style={{ padding: "var(--sp-4) var(--sp-28) 0" }}>
          {["Today", "Overdue", "Coming up", "Done today"].map((l) => (
            <div className="stat" key={l}><small>{l}</small><b>{skeleton ? <span className="skel" /> : "\u00a0"}</b></div>
          ))}
        </div>
        <div className="cols today-cols">
          <div className="blk" aria-busy="true"><div className="bh"><b>Today</b><span></span></div>{skeleton && <ul>{loadingRows(6)}</ul>}</div>
          <div className="blk aside">
            <div className="bh"><b>This week</b><span></span></div>
            {skeleton && Array.from({ length: 5 }, (_, i) => <div className="kv" key={i}><span><span className="skel" style={{ width: "var(--sp-44)" }} /></span><span className="skel" style={{ width: "var(--sp-120)" }} /></div>)}
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader title={title} sub={`${dayName} ${now.getDate()} ${MONTHS[now.getMonth()]} · ${status.kind === "offline" ? "offline" : summary}`}>
        <SyncLine status={status} onRetry={retry} waiting={waiting} />
        <button type="button" className="btn" onClick={() => ui.openNewTask()}>
          <Icon name="plus" small />
          New task
        </button>
      </PageHeader>

      <div className="grid4 today-stats" style={{ padding: "var(--sp-4) var(--sp-28) 0" }}>
        <div className="stat"><small>Today</small><b>{todayOpen + eventsToCome}</b></div>
        <div className="stat"><small>Overdue</small><b style={g.overdue.length > 0 ? { color: "var(--amber-text)" } : undefined}>{g.overdue.length}</b></div>
        <div className="stat"><small>Coming up</small><b>{comingUp}</b></div>
        <div className="stat"><small>Done today</small><b>{g.doneToday}</b></div>
      </div>

      <div className="cols today-cols">
        <div className="blk">
          {!phone && (
            <div className="bh">
              <b>Today</b>
              <span>{dateLabel}</span>
            </div>
          )}
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
              {entries.length > 0 && <ul>{rows(entries.slice(0, entryRows), entries.length)}</ul>}
              {g.overdue.length > 0 && (
                <>
                  <div className="bh" style={{ paddingTop: "var(--sp-16)" }}>
                    <b className="amber">Overdue</b>
                    <span>{g.overdue.length}</span>
                  </div>
                  <ul>
                    {g.overdue.slice(0, lateRows).map((t, i) => (
                      <TodayRow key={t.id} task={t} unsynced={unsynced.has(t.id)} late={lateDays(t.due!)} quietLate={phone} at={place(i, g.overdue.length)} />
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
                <b>{countWords(comingUp, "item", "items")} <Icon name={weekOpen ? "down" : "right"} small /></b>
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
                  <div className="kv"><span>{project.name}</span><b>{percent}% · {goalLabel(project.goal!, now)}</b></div>
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
