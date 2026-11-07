import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useUi } from "../../app/ui";
import { WEEKDAYS, dateOf, formatTime, parseDue } from "../../lib/dates";
import { touchesDay } from "../../lib/wall";
import { usePlanner } from "../../store/context";
import type { Occurrence } from "../../store/occurrences";
import type { CalendarEvent, Task } from "../../store/types";
import { dueText, isOpen, needsAction, sortByDue } from "../tasks/selectors";
import { TodayRow, useTaskActions } from "../tasks/TaskRow";
import { HOUR_PX } from "../../styles/tokens";
import { countOverlaps, isAllDayLike, layoutDay } from "./layout";

const px = (minutes: number) => (minutes * HOUR_PX) / 60;

export function colourOf(calendars: readonly { id: string; colour: string }[], event: CalendarEvent): string {
  return `var(--${calendars.find((c) => c.id === event.calendarId)?.colour ?? "c1"})`;
}

function range(occ: Occurrence): string {
  if (occ.allDay) return "All day";
  const a = parseDue(occ.start).date;
  const b = parseDue(occ.end).date;
  return occ.start === occ.end ? formatTime(a) : `${formatTime(a)} to ${formatTime(b)}`;
}

function TaskCard({ task, now }: { task: Task; now: Date }) {
  const { open } = useTaskActions(task);
  return (
    <li className="tcard" data-done={task.done}>
      <button type="button" className="tt link-btn" onClick={open}>{task.title}</button>
      <span className="m" style={needsAction(task, now) ? { color: "var(--amber-text)" } : undefined}>{dueText(task, now)}</span>
    </li>
  );
}

export function TimeGrid({ days, occurrences, today, now, mode }: { days: string[]; occurrences: Occurrence[]; today: string; now: Date; mode: "week" | "day" }) {
  const { calendars, tasks } = usePlanner();
  const ui = useUi();
  const scroller = useRef<HTMLDivElement>(null);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  const byDay = useMemo(() => {
    const map = new Map<string, Occurrence[]>();
    for (const d of days) map.set(d, occurrences.filter((o) => touchesDay(o, d)));
    return map;
  }, [days, occurrences]);
  const allDay = occurrences.filter(isAllDayLike);
  const overlaps = useMemo(() => countOverlaps(byDay), [byDay]);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = px(days.includes(today) ? Math.max(nowMinutes - 120, 0) : 7 * 60);
    // Scroll once per set of days, not on every tick of the clock.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days.join(",")]);

  // One slot takes the Tab stop; arrows move between hours and days, Enter adds an event there.
  const [stop, setStop] = useState({ day: days[0]!, hour: 9 });
  if (!days.includes(stop.day)) setStop({ day: days.includes(today) ? today : days[0]!, hour: stop.hour });
  const slotLabel = (d: string) => {
    const date = dateOf(d);
    return `${WEEKDAYS[date.getDay()]} ${date.getDate()}`;
  };
  const onSlotKey = (event: KeyboardEvent<HTMLElement>, day: string, hour: number) => {
    const delta = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[event.key];
    if (delta) {
      event.preventDefault();
      const nextDay = days[days.indexOf(day) + delta[0]!];
      const nextHour = hour + delta[1]!;
      if (nextDay !== undefined && nextHour >= 0 && nextHour < 24) {
        setStop({ day: nextDay, hour: nextHour });
        scroller.current?.querySelector<HTMLElement>(`[data-slot="${nextDay}T${nextHour}"]`)?.focus();
      }
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      ui.openNewEvent(day, `${String(hour).padStart(2, "0")}:00`);
    }
  };

  const columns = `var(--sp-44) repeat(${days.length}, minmax(0, 1fr))`;
  const first = days[0]!;
  const last = days.at(-1)!;
  const dueTasks = sortByDue(tasks.filter((t) => isOpen(t) && t.due !== null && t.due.slice(0, 10) >= first && t.due.slice(0, 10) <= last));
  const todayTasks = tasks.filter((t) => t.deletedAt === null && t.due !== null && t.due.slice(0, 10) === first);

  return (
    <div className={mode === "day" ? "calwrap day" : "calwrap"}>
      <div className="calmain">
        <div className="cal" style={{ gridTemplateColumns: columns }}>
          <div />
          {days.map((d) => {
            const date = dateOf(d);
            return (
              <div key={d} className={d === today ? "dh today" : "dh"}>
                {WEEKDAYS[date.getDay()]!.slice(0, 3)} <b>{date.getDate()}</b>
              </div>
            );
          })}
          {allDay.length > 0 && (
            <>
              <div className="adl">All day</div>
              {days.map((d) => (
                <div key={d} className="adc">
                  {byDay.get(d)!.filter(isAllDayLike).map((o) => (
                    <button key={`${o.event.id}-${o.date}`} type="button" className="chipx allday" style={{ borderLeft: `var(--bw-3) solid ${colourOf(calendars, o.event)}` }} onClick={() => ui.openEvent(o.event.id, o.date)}>
                      {o.event.title}
                    </button>
                  ))}
                </div>
              ))}
            </>
          )}
        </div>
        <div className="calscroll" ref={scroller}>
          <div className="cal" style={{ gridTemplateColumns: columns }}>
            <div>
              {Array.from({ length: 24 }, (_, h) => (
                <div className="hr" key={h}>{h === 0 ? "" : `${h}:00`}</div>
              ))}
            </div>
            {days.map((d) => (
              <div className="dcol" key={d} data-day={d}>
                {Array.from({ length: 24 }, (_, h) => (
                  <div
                    className="slot"
                    key={h}
                    role="button"
                    data-slot={`${d}T${h}`}
                    tabIndex={stop.day === d && stop.hour === h ? 0 : -1}
                    aria-label={`${slotLabel(d)}, ${h}:00. Enter adds an event.`}
                    onFocus={() => setStop({ day: d, hour: h })}
                    onClick={() => ui.openNewEvent(d, `${String(h).padStart(2, "0")}:00`)}
                    onKeyDown={(e) => onSlotKey(e, d, h)}
                  />
                ))}
                {layoutDay(byDay.get(d)!, d).map((p) => {
                  const o = p.occ;
                  const width = 100 / p.columns;
                  const label = mode === "day" ? `${range(o)}${o.event.place ? ` · ${o.event.place}` : ""}` : formatTime(parseDue(o.start).date);
                  return (
                    <button
                      key={`${o.event.id}-${o.date}`}
                      type="button"
                      data-row-id={o.event.id}
                      className={p.overlaps ? "ev clash" : "ev"}
                      aria-current={ui.eventKey?.id === o.event.id && ui.eventKey.date === o.date ? "true" : undefined}
                      style={{
                        top: px(p.top),
                        height: `calc(${px(p.height)}px - var(--sp-2))`,
                        left: `calc(${p.column * width}% + var(--sp-4))`,
                        width: `calc(${width}% - var(--sp-8))`,
                        borderLeftColor: colourOf(calendars, o.event),
                      }}
                      onClick={() => ui.openEvent(o.event.id, o.date)}
                    >
                      {o.event.title}
                      <small>
                        {label}
                        {p.overlaps && <span className="amber"> · overlaps</span>}
                      </small>
                    </button>
                  );
                })}
                {d === today && <div className="now" style={{ top: px(nowMinutes) }} data-testid="now" />}
              </div>
            ))}
          </div>
        </div>
      </div>

      <aside className="cal-side" aria-label={mode === "day" ? "Tasks today" : "This week"}>
        {mode === "week" ? (
          <>
            <div className="bh"><b>This week</b></div>
            <div className="kv"><span>Events</span><b>{occurrences.length}</b></div>
            <div className="kv"><span>Overlaps</span><b style={overlaps > 0 ? { color: "var(--amber-text)" } : undefined}>{overlaps}</b></div>
            <div className="bh"><b>Due this week</b></div>
            {dueTasks.length === 0 ? (
              <p className="quiet">No tasks due.</p>
            ) : (
              <ul className="cards">
                {dueTasks.map((t) => (
                  <TaskCard key={t.id} task={t} now={now} />
                ))}
              </ul>
            )}
          </>
        ) : (
          <>
            <div className="bh"><b>Tasks today</b><span>{todayTasks.length}</span></div>
            {todayTasks.length === 0 ? (
              <p className="quiet">No tasks for this day.</p>
            ) : (
              <ul>
                {sortByDue(todayTasks).map((t) => (
                  <TodayRow key={t.id} task={t} compact />
                ))}
              </ul>
            )}
            {allDay.length > 0 && (
              <>
                <div className="bh"><b>All day</b></div>
                <ul className="cards">
                  {allDay.map((o) => (
                    <li className="tcard" key={`${o.event.id}-${o.date}`}>
                      <button type="button" className="tt link-btn" onClick={() => ui.openEvent(o.event.id, o.date)}>{o.event.title}</button>
                      <span className="m">
                        <span className="sw" style={{ background: colourOf(calendars, o.event) }} />
                        {calendars.find((c) => c.id === o.event.calendarId)?.name}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </aside>
    </div>
  );
}
