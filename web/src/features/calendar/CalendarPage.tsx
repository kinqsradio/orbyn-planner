import { useMemo, useState } from "react";
import { useNow } from "../../app/clock";
import { usePrefs } from "../../app/prefs";
import { useUi } from "../../app/ui";
import { PageHeader } from "../../components/EmptyState";
import { Icon } from "../../components/Icon";
import { PHONE_QUERY, useMediaQuery } from "../../components/useMediaQuery";
import { MONTHS, WEEKDAYS, addDays, dateKey, dateOf, isoWeek, weekStartOf } from "../../lib/dates";
import { usePlanner } from "../../store/context";
import { expandEvents } from "../../store/occurrences";
import { AgendaView } from "./AgendaView";
import { MonthView } from "./MonthView";
import { PhoneCalendar } from "./PhoneCalendar";
import { TimeGrid } from "./TimeGrid";

export type View = "month" | "week" | "day" | "agenda";
const VIEWS: readonly { id: View; label: string }[] = [
  { id: "month", label: "Month" },
  { id: "week", label: "Week" },
  { id: "day", label: "Day" },
  { id: "agenda", label: "Agenda" },
];

/** The days a view shows around `anchor`. */
export function viewDays(view: View, anchor: string, weekStart: "mon" | "sun", weekDays: 5 | 7, today: string): string[] {
  const a = dateOf(anchor);
  if (view === "day") return [anchor];
  if (view === "agenda") return Array.from({ length: 7 }, (_, i) => dateKey(addDays(a, i)));
  if (view === "week") {
    // Monday to Friday would hide today when today is a weekend day of the week being shown.
    const monday = weekStartOf(a, "mon");
    const t = dateOf(today);
    const todayHidden = (t.getDay() === 0 || t.getDay() === 6) && dateKey(weekStartOf(t, "mon")) === dateKey(monday);
    const count = weekDays === 5 && !todayHidden ? 5 : 7;
    const first = count === 5 ? monday : weekStartOf(a, weekStart);
    return Array.from({ length: count }, (_, i) => dateKey(addDays(first, i)));
  }
  const gridStart = weekStartOf(new Date(a.getFullYear(), a.getMonth(), 1), weekStart);
  return Array.from({ length: 42 }, (_, i) => dateKey(addDays(gridStart, i)));
}

function shift(view: View, anchor: string, direction: 1 | -1): string {
  const a = dateOf(anchor);
  if (view === "day") return dateKey(addDays(a, direction));
  if (view === "month") return dateKey(new Date(a.getFullYear(), a.getMonth() + direction, 1));
  return dateKey(addDays(a, 7 * direction));
}

export function CalendarPage() {
  const phone = useMediaQuery(PHONE_QUERY);
  const now = useNow();
  // On a phone the Calendar is the day strip and the day's list; the grids are for larger screens.
  if (phone) return <PhoneCalendar today={dateKey(now)} />;
  return <CalendarGrid />;
}

function CalendarGrid() {
  const { events, calendars } = usePlanner();
  const now = useNow();
  const ui = useUi();
  const { prefs } = usePrefs();
  const [view, setView] = useState<View>("week");
  const [anchor, setAnchor] = useState(() => dateKey(now));

  const todayKey = dateKey(now);
  const days = useMemo(() => viewDays(view, anchor, prefs.weekStart, prefs.weekDays, todayKey), [view, anchor, prefs.weekStart, prefs.weekDays, todayKey]);
  const shown = useMemo(() => {
    const visible = new Set(calendars.filter((c) => c.visible).map((c) => c.id));
    return events.filter((e) => visible.has(e.calendarId));
  }, [events, calendars]);
  const occurrences = useMemo(() => expandEvents(shown, days[0]!, days.at(-1)!), [shown, days]);

  const a = dateOf(anchor);
  const title =
    view === "day" ? `${WEEKDAYS[a.getDay()]} ${a.getDate()} ${MONTHS[a.getMonth()]}` : view === "agenda" ? "Agenda" : `${MONTHS[a.getMonth()]} ${a.getFullYear()}`;
  const sub = view === "week" ? `Week ${isoWeek(dateOf(days[0]!))}` : view === "day" ? "Day" : view === "agenda" ? "Next 7 days" : "";
  const today = dateKey(now);

  return (
    <>
      <PageHeader title={title} sub={sub}>
        <button type="button" className="ghost icon" aria-label="Previous" onClick={() => setAnchor(shift(view, anchor, -1))}>
          <Icon name="left" small />
        </button>
        <button type="button" className="ghost" onClick={() => setAnchor(today)}>Today</button>
        <button type="button" className="ghost icon" aria-label="Next" onClick={() => setAnchor(shift(view, anchor, 1))}>
          <Icon name="right" small />
        </button>
        <div role="radiogroup" aria-label="View" className="pills">
          {VIEWS.map((v) => (
            <button key={v.id} type="button" role="radio" aria-checked={view === v.id} className="pill" onClick={() => setView(v.id)}>
              {v.label}
            </button>
          ))}
        </div>
        <button type="button" className="ghost" onClick={ui.openCalendars}>Calendars</button>
        <button type="button" className="btn keep" onClick={() => ui.openNewEvent(view === "day" ? anchor : today)}>
          <Icon name="plus" small />
          New event
        </button>
      </PageHeader>

      {view === "month" ? (
        <MonthView days={days} anchor={anchor} occurrences={occurrences} today={today} weekStart={prefs.weekStart} onDay={(d) => { setAnchor(d); setView("day"); }} />
      ) : view === "agenda" ? (
        <AgendaView days={days} occurrences={occurrences} today={today} />
      ) : (
        <TimeGrid days={days} occurrences={occurrences} today={today} now={now} mode={view} />
      )}
    </>
  );
}
