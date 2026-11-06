import { useUi } from "../../app/ui";
import { EmptyState } from "../../components/EmptyState";
import { dateOf, formatTime, parseDue, shortDay } from "../../lib/dates";
import { touchesDay } from "../../lib/wall";
import { usePlanner } from "../../store/context";
import type { Occurrence } from "../../store/occurrences";
import { colourOf } from "./TimeGrid";

function length(o: Occurrence): string {
  const minutes = Math.round((parseDue(o.end).date.getTime() - parseDue(o.start).date.getTime()) / 60_000);
  if (o.allDay || minutes <= 0) return "";
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  return minutes % 60 ? `${h}h ${minutes % 60}m` : `${h}h`;
}

export function AgendaView({ days, occurrences, today }: { days: string[]; occurrences: Occurrence[]; today: string }) {
  const { calendars } = usePlanner();
  const ui = useUi();
  const groups = days
    .map((day) => ({ day, items: occurrences.filter((o) => touchesDay(o, day)) }))
    .filter((g) => g.items.length > 0);

  if (groups.length === 0) {
    return <EmptyState title="Nothing coming up" body="Events for the next 7 days will appear here." />;
  }
  return (
    <div className="pad">
      {groups.map((g, i) => (
        <section key={g.day} aria-label={g.day}>
          <div className="bh" style={i === 0 ? { paddingTop: 0 } : undefined}>
            <b>{g.day === today ? `Today · ${shortDay(dateOf(g.day))}` : shortDay(dateOf(g.day))}</b>
          </div>
          <ul>
            {g.items.map((o) => {
              const meta = [o.event.place, length(o)].filter(Boolean);
              return (
                <li
                  className="row"
                  data-row-id={o.event.id}
                  key={`${o.event.id}-${o.date}-${g.day}`}
                  style={ui.eventKey?.id === o.event.id && ui.eventKey.date === o.date ? { background: "var(--sel)", borderRadius: 8, padding: "0 8px" } : undefined}
                >
                  <span className="time">{o.allDay ? "All day" : formatTime(parseDue(o.start).date)}</span>
                  <span className="sw" style={{ background: colourOf(calendars, o.event) }} aria-hidden="true" />
                  <button type="button" className="what link-btn" onClick={() => ui.openEvent(o.event.id, o.date)}>{o.event.title}</button>
                  <span className="meta">{meta.join(" · ")}</span>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
