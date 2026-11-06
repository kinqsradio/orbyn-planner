import { useUi } from "../../app/ui";
import { WEEKDAYS, dateOf } from "../../lib/dates";
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

  return (
    <div className="month" role="grid" aria-label="Month">
      {order.map((d) => (
        <div className="mh" role="columnheader" key={d}>{WEEKDAYS[d]!.slice(0, 3)}</div>
      ))}
      {shownDays.map((day) => {
        const date = dateOf(day);
        const inMonth = date.getMonth() === month;
        const here = occurrences.filter((o) => touchesDay(o, day));
        const classes = ["md", day === today ? "today" : "", inMonth ? "" : "out"].filter(Boolean).join(" ");
        return (
          <div className={classes} role="gridcell" key={day} data-day={day}>
            <button type="button" className="n" aria-label={`${date.getDate()} ${WEEKDAYS[date.getDay()]}`} onClick={() => onDay(day)}>{date.getDate()}</button>
            {here.slice(0, MAX_CHIPS).map((o) => (
              <button key={`${o.event.id}-${o.date}-${day}`} type="button" className="chipx" onClick={() => ui.openEvent(o.event.id, o.date)}>
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
  );
}
