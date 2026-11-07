import { useCallback, useMemo, useState, type KeyboardEvent, type TouchEvent } from "react";
import { usePrefs } from "../../app/prefs";
import { useUi } from "../../app/ui";
import { Icon } from "../../components/Icon";
import { Modal } from "../../components/Modal";
import { MONTHS, WEEKDAYS, addDays, dateKey, dateOf, formatTime, isoWeek, parseDue } from "../../lib/dates";
import { wallMinutes } from "../../lib/wall";
import { usePlanner } from "../../store/context";
import { expandEvents, type Occurrence } from "../../store/occurrences";
import type { Task } from "../../store/types";
import { Check, useTaskActions } from "../tasks/TaskRow";
import { useSyncController, useSyncState } from "../../sync/SyncProvider";
import { SyncLine, useSyncStatus, withPersistence } from "../sync/SyncLine";
import { colourOf } from "./TimeGrid";

const dayName = (key: string) => `${WEEKDAYS[dateOf(key).getDay()]!.slice(0, 3)} ${dateOf(key).getDate()}`;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const shift = (key: string, days: number) => dateKey(addDays(dateOf(key), days));
/** How far a finger has to travel sideways before it is a swipe, in CSS pixels. */
const SWIPE_PX = 40;

/** "30 min", "1 h", "1 h 30 min": how long a timed event lasts. */
export function duration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return [h > 0 && `${h} h`, m > 0 && `${m} min`].filter(Boolean).join(" ") || "0 min";
}

/** What an event row says after its title: the place, or if it has none its length, never both; an all-day event says neither. */
export function eventMeta(o: Pick<Occurrence, "allDay" | "start" | "end"> & { event: { place: string } }): string {
  if (o.allDay) return "";
  if (o.event.place) return o.event.place;
  const minutes = wallMinutes(o.end) - wallMinutes(o.start);
  return minutes > 0 ? duration(minutes) : "";
}

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

/** The month sheet: a month grid with Today and Done. It uses the shared dialog rule (focus in, Tab kept inside, Escape closes). */
function MonthPicker({ selected, today, onPick, onClose }: { selected: string; today: string; onPick: (day: string) => void; onClose: () => void }) {
  const { prefs } = usePrefs();
  const [month, setMonth] = useState(() => dateKey(new Date(dateOf(selected).getFullYear(), dateOf(selected).getMonth(), 1)));
  const first = dateOf(month);
  const lead = (first.getDay() - (prefs.weekStart === "mon" ? 1 : 0) + 7) % 7;
  const count = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  // Days of the neighbouring months fill the first and last weeks, quietly.
  const total = Math.ceil((lead + count) / 7) * 7;
  const cells = Array.from({ length: total }, (_, i) => shift(month, i - lead));
  const heads = prefs.weekStart === "mon" ? [1, 2, 3, 4, 5, 6, 0] : [0, 1, 2, 3, 4, 5, 6];
  const move = (by: number) => setMonth(dateKey(new Date(first.getFullYear(), first.getMonth() + by, 1)));
  return (
    <Modal label="Choose a day" onClose={onClose} className="month-sheet">
      <div className="ms-head">
        <button type="button" className="ghost icon" aria-label="Previous month" onClick={() => move(-1)}><Icon name="left" small /></button>
        <b>{MONTHS[first.getMonth()]} {first.getFullYear()}</b>
        <button type="button" className="ghost icon" aria-label="Next month" onClick={() => move(1)}><Icon name="right" small /></button>
      </div>
      <div className="ms-grid" role="grid" aria-label="Days">
        {heads.map((d) => <span key={d} className="ms-dow" aria-hidden="true">{WEEKDAYS[d]!.slice(0, 1)}</span>)}
        {cells.map((d) => (
          <button
            key={d}
            type="button"
            className={[d === selected && "on", d === today && "today", dateOf(d).getMonth() !== first.getMonth() && "quiet"].filter(Boolean).join(" ") || undefined}
            aria-pressed={d === selected}
            aria-label={dayName(d)}
            onClick={() => onPick(d)}
          >
            {dateOf(d).getDate()}
          </button>
        ))}
      </div>
      <div className="dialog-actions">
        <button type="button" className="ghost" onClick={() => { onPick(today); setMonth(dateKey(new Date(dateOf(today).getFullYear(), dateOf(today).getMonth(), 1))); }}>Today</button>
        <button type="button" className="btn" data-autofocus onClick={onClose}>Done</button>
      </div>
    </Modal>
  );
}

/**
 * The Calendar on a phone: the title is the month (tap it for a month sheet), the sub line the week and the chosen day, a strip of five
 * days with the chosen one in the middle, and that day's list below. Tap a day to choose it; swipe the strip to move five days, swipe the
 * list to move one; a quiet Today button comes back from any other day. An empty day says "Nothing planned" under its header
 * (Planner Designs p-phone-week, p-cal-day-empty-phone, p-phone-day-nav and p-phone-month-picker).
 */
export function PhoneCalendar({ today }: { today: string }) {
  const { events, calendars, tasks, outbox, persistence } = usePlanner();
  const ui = useUi();
  const sync = useSyncState();
  const controller = useSyncController();
  const syncNow = useCallback(() => controller?.syncNow(), [controller]);
  const { status: health, retry } = useSyncStatus(outbox.length, sync, syncNow);
  const status = withPersistence(health, persistence);
  const [day, setDay] = useState(today);
  const [picker, setPicker] = useState(false);
  const [from, setFrom] = useState<{ x: number; y: number } | null>(null);
  const [direction, setDirection] = useState<"next" | "previous" | null>(null);

  const strip = useMemo(() => Array.from({ length: 5 }, (_, i) => shift(day, i - 2)), [day]);
  const occurrences = useMemo(() => {
    const visible = new Set(calendars.filter((c) => c.visible).map((c) => c.id));
    return expandEvents(events.filter((e) => visible.has(e.calendarId)), day, day);
  }, [events, calendars, day]);
  const dayTasks = useMemo(() => tasks.filter((t) => t.deletedAt === null && t.due !== null && t.due.slice(0, 10) === day), [tasks, day]);

  const go = (to: string) => {
    setDirection(to > day ? "next" : to < day ? "previous" : null);
    setDay(to);
  };
  const swipe = (event: TouchEvent, days: number) => {
    const end = event.changedTouches[0];
    if (!from || !end) return;
    const dx = end.clientX - from.x;
    const dy = end.clientY - from.y;
    setFrom(null);
    if (Math.abs(dx) < SWIPE_PX || Math.abs(dx) < Math.abs(dy)) return; // a short move, or mostly a scroll
    go(shift(day, dx < 0 ? days : -days));
  };
  const touch = (days: number) => ({
    onTouchStart: (e: TouchEvent) => setFrom({ x: e.touches[0]!.clientX, y: e.touches[0]!.clientY }),
    onTouchEnd: (e: TouchEvent) => swipe(e, days),
  });
  const keys = (e: KeyboardEvent) => {
    if (e.key === "ArrowLeft") go(shift(day, -1));
    else if (e.key === "ArrowRight") go(shift(day, 1));
    else return;
    e.preventDefault();
  };

  const key = (o: Occurrence) => (o.allDay ? "" : o.start.slice(11, 16));
  const items = [
    ...occurrences.map((o) => ({ at: key(o), o, t: null as Task | null })),
    ...dayTasks.map((t) => ({ at: t.due!.length > 10 ? t.due!.slice(11, 16) : "99:99", o: null as Occurrence | null, t })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  const count = [occurrences.length > 0 && plural(occurrences.length, "event", "events"), dayTasks.length > 0 && plural(dayTasks.length, "task", "tasks")].filter(Boolean).join(" · ");
  const month = MONTHS[dateOf(day).getMonth()]!;
  const sub = `Week ${isoWeek(dateOf(day))} · ${day === today ? "Today" : dayName(day)}${status.kind === "offline" ? " · offline" : ""}`;

  return (
    <>
      <div className="ph pm-head">
        <h1>
          <button type="button" className="month-title" aria-haspopup="dialog" onClick={() => setPicker(true)}>{month}<Icon name="down" small /></button>
        </h1>
        {day !== today && <button type="button" className="link-btn quiet-link pm-today" onClick={() => go(today)}>Today</button>}
        <span className="sub">{sub}</span>
        <div className="acts"><SyncLine status={status} onRetry={retry} /></div>
      </div>
      <div className="pad">
        <div className="pm-day" role="group" aria-label="Days" onKeyDown={keys} {...touch(5)}>
          {strip.map((d) => (
            <button key={d} type="button" className={d === day ? "on" : undefined} aria-pressed={d === day} aria-current={d === today ? "date" : undefined} aria-label={dayName(d)} onClick={() => go(d)}>
              {WEEKDAYS[dateOf(d).getDay()]!.slice(0, 3)}
              <b>{dateOf(d).getDate()}</b>
              <i style={{ visibility: d === today ? "visible" : "hidden" }} />
            </button>
          ))}
        </div>
        <div className="pm-list" data-direction={direction ?? undefined} {...touch(1)}>
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
                    <span className="meta">{eventMeta(o)}</span>
                  </li>
                ) : (
                  <TaskLine key={t!.id} task={t!} />
                ),
              )}
            </ul>
          )}
        </div>
      </div>
      {picker && <MonthPicker selected={day} today={today} onPick={go} onClose={() => setPicker(false)} />}
    </>
  );
}
