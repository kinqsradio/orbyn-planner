import { useState, type KeyboardEvent } from "react";
import { useUi } from "../../app/ui";
import { WEEKDAYS, addDays, dateKey, dateOf } from "../../lib/dates";
import { touchesDay } from "../../lib/wall";
import { usePlanner } from "../../store/context";
import type { Occurrence } from "../../store/occurrences";
import { colourOf } from "./TimeGrid";

const MAX_CHIPS = 3;

export function MonthView({ days, anchor, occurrences, today, weekStart, onDay }: {
  days: string[];
  anchor: string;
  occurrences: Occurrence[];
  today: string;
  weekStart: "mon" | "sun";
  onDay: (day: string) => void;
}) {
  const { calendars } = usePlanner();
  const ui = useUi();
  const month = dateOf(anchor).getMonth();
  const order = weekStart === "mon" ? [1, 2, 3, 4, 5, 6, 0] : [0, 1, 2, 3, 4, 5, 6];
  // Hide a sixth week that falls wholly in the next month.
  const shownDays = days.slice(0, 35).concat(dateOf(days[35]!).getMonth() === month ? days.slice(35) : []);

  // One day takes the Tab stop; the arrow keys move between days.
  const [focusDay, setFocusDay] = useState<string | null>(null);
  const stop = shownDays.includes(focusDay ?? "") ? focusDay! : shownDays.includes(today) ? today : shownDays.find((d) => dateOf(d).getMonth() === month)!;

  const onKey = (event: KeyboardEvent<HTMLDivElement>, day: string) => {
    if (event.target !== event.currentTarget) return;
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
    if (step !== undefined) {
      event.preventDefault();
      const next = dateKey(addDays(dateOf(day), step));
      if (shownDays.includes(next)) {
        setFocusDay(next);
        event.currentTarget.parentElement?.parentElement?.querySelector<HTMLElement>(`[data-day="${next}"]`)?.focus();
      }
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      ui.openNewEvent(day);
    }
  };

  const weeks = Array.from({ length: shownDays.length / 7 }, (_, i) => shownDays.slice(i * 7, i * 7 + 7));

  return (
    <div className="month" role="grid" aria-label="Month">
      <div role="row" className="month-row">
        {order.map((d) => (
          <div className="mh" role="columnheader" key={d}>{WEEKDAYS[d]!.slice(0, 3)}</div>
        ))}
      </div>
      {weeks.map((week) => (
        <div role="row" className="month-row" key={week[0]}>
          {week.map((day) => {
            const date = dateOf(day);
            const inMonth = date.getMonth() === month;
            const here = occurrences.filter((o) => touchesDay(o, day));
            const classes = ["md", day === today ? "today" : "", inMonth ? "" : "out"].filter(Boolean).join(" ");
            return (
              <div
                className={classes}
                role="gridcell"
                key={day}
                data-day={day}
                tabIndex={day === stop ? 0 : -1}
                aria-label={`${WEEKDAYS[date.getDay()]} ${date.getDate()}. Enter adds an event.`}
                onFocus={(e) => e.target === e.currentTarget && setFocusDay(day)}
                onKeyDown={(e) => onKey(e, day)}
              >
                <button type="button" className="n" aria-label={`${date.getDate()} ${WEEKDAYS[date.getDay()]}`} onClick={() => onDay(day)}>{date.getDate()}</button>
                {here.slice(0, MAX_CHIPS).map((o) => (
                  <button key={`${o.event.id}-${o.date}-${day}`} type="button" data-row-id={o.event.id} className="chipx" onClick={() => ui.openEvent(o.event.id, o.date)}>
                    <span className="sw" style={{ background: colourOf(calendars, o.event) }} aria-hidden="true" />
                    {o.event.title}
                  </button>
                ))}
                {here.length > MAX_CHIPS && (
                  <button type="button" className="more-link" onClick={() => onDay(day)}>+{here.length - MAX_CHIPS} more</button>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
