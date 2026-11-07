import { useMemo, useState } from "react";
import { useUi } from "../../app/ui";
import { PageHeader } from "../../components/EmptyState";
import { MONTHS, WEEKDAYS, addDays, dateKey, dateOf, formatTime, isoWeek, parseDue } from "../../lib/dates";
import { usePlanner } from "../../store/context";
import { expandEvents, type Occurrence } from "../../store/occurrences";
import type { Task } from "../../store/types";
import { Check, useTaskActions } from "../tasks/TaskRow";
import { colourOf } from "./TimeGrid";

const dayName = (key: string) => `${WEEKDAYS[dateOf(key).getDay()]!.slice(0, 3)} ${dateOf(key).getDate()}`;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function TaskLine({ task }: { task: Task }) {
  const { open } = useTaskActions(task);
  const parsed = task.due ? parseDue(task.due) : null;
  return (
    <li className={task.done ? "row done" : "row"} data-row-id={task.id}>
      <span className="time">{parsed?.hasTime ? formatTime(parsed.date) : "Any"}</span>
      <Check task={task} />
      <button type="button" className="what link-btn" onClick={open}>{task.title}</button>
      <span className="meta" />
    </li>
  );
}

/**
 * The Calendar on a phone: the title is the month, the sub line the week (and the day, when it is not today), a strip of five days
 * ending today, and the chosen day's list below. A day with nothing on it says "Nothing planned" under its header (Planner Designs
 * p-phone-week and p-cal-day-empty-phone).
 */
export function PhoneCalendar({ today }: { today: string }) {
  const { events, calendars, tasks } = usePlanner();
  const ui = useUi();
  const [picked, setPicked] = useState(today);
  const strip = useMemo(() => Array.from({ length: 5 }, (_, i) => dateKey(addDays(dateOf(today), i - 4))), [today]);
  const day = strip.includes(picked) ? picked : today;
  const occurrences = useMemo(() => {
    const visible = new Set(calendars.filter((c) => c.visible).map((c) => c.id));
    return expandEvents(events.filter((e) => visible.has(e.calendarId)), day, day);
  }, [events, calendars, day]);
  const dayTasks = useMemo(() => tasks.filter((t) => t.deletedAt === null && t.due !== null && t.due.slice(0, 10) === day), [tasks, day]);

  const key = (o: Occurrence) => (o.allDay ? "" : o.start.slice(11, 16));
  const items = [
    ...occurrences.map((o) => ({ at: key(o), o, t: null as Task | null })),
    ...dayTasks.map((t) => ({ at: t.due!.length > 10 ? t.due!.slice(11, 16) : "99:99", o: null as Occurrence | null, t })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  const count = [occurrences.length > 0 && plural(occurrences.length, "event", "events"), dayTasks.length > 0 && plural(dayTasks.length, "task", "tasks")].filter(Boolean).join(" · ");
  const month = MONTHS[dateOf(day).getMonth()]!;
  const sub = `Week ${isoWeek(dateOf(day))}${day === today ? "" : ` · ${dayName(day)}`}`;

  return (
    <>
      <PageHeader title={month} sub={sub} />
      <div className="pad">
        <div className="pm-day" role="group" aria-label="Days">
          {strip.map((d) => (
            <button key={d} type="button" className={d === day ? "on" : undefined} aria-pressed={d === day} aria-label={dayName(d)} onClick={() => setPicked(d)}>
              {WEEKDAYS[dateOf(d).getDay()]!.slice(0, 3)}
              <b>{dateOf(d).getDate()}</b>
              <i />
            </button>
          ))}
        </div>
        <div className="bh"><b>{dayName(day)}</b><span>{count}</span></div>
        {items.length === 0 ? (
          <p className="t3 pm-empty">Nothing planned</p>
        ) : (
          <ul>
            {items.map(({ o, t }) =>
              o ? (
                <li className="row" key={`${o.event.id}-${o.date}`} data-row-id={o.event.id}>
                  <span className="time">{o.allDay ? "All day" : formatTime(parseDue(o.start).date)}</span>
                  <span className="sw" style={{ background: colourOf(calendars, o.event) }} aria-hidden="true" />
                  <button type="button" className="what link-btn" onClick={() => ui.openEvent(o.event.id, o.date)}>{o.event.title}</button>
                  <span className="meta">{o.event.place}</span>
                </li>
              ) : (
                <TaskLine key={t!.id} task={t!} />
              ),
            )}
          </ul>
        )}
      </div>
    </>
  );
}
