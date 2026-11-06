import { useRef } from "react";
import { useUi } from "../../app/ui";
import { Portal } from "../../components/Portal";
import { useDialog } from "../../components/useDialog";
import { usePlanner } from "../../store/context";
import { NOT_SUPPORTED } from "../../lib/ics";
import { CalendarForms, CalendarList } from "./CalendarList";

export function CalendarsDialog() {
  const ui = useUi();
  const ref = useRef<HTMLDivElement>(null);
  useDialog(ref, ui.closeCalendars);
  const { events, calendars } = usePlanner();
  // Subscribed events with a repeat this app cannot say: only their first date shows.
  const unsupported = events.filter((e) => e.readOnly && e.deletedAt === null && e.notes.includes(NOT_SUPPORTED));
  return (
    <Portal>
      <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && ui.closeCalendars()}>
        <div ref={ref} className="authcard wide" role="dialog" aria-modal="true" aria-label="Calendars" tabIndex={-1}>
          <b className="card-title">Calendars</b>
          <CalendarList />
          {unsupported.length > 0 && (
            <section aria-label="Can’t show these repeats">
              <b>Can’t show these repeats</b>
              <p className="t3">Only the first date of each is shown.</p>
              <ul>
                {unsupported.map((e) => (
                  <li key={e.id}>{e.title} <span className="t3">· {calendars.find((c) => c.id === e.calendarId)?.name ?? ""}</span></li>
                ))}
              </ul>
            </section>
          )}
          <CalendarForms onDone={ui.closeCalendars} />
        </div>
      </div>
    </Portal>
  );
}
