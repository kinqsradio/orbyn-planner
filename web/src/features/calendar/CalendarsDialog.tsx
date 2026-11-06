import { useRef } from "react";
import { useUi } from "../../app/ui";
import { Portal } from "../../components/Portal";
import { useDialog } from "../../components/useDialog";
import { CalendarForms, CalendarList } from "./CalendarList";

export function CalendarsDialog() {
  const ui = useUi();
  const ref = useRef<HTMLDivElement>(null);
  useDialog(ref, ui.closeCalendars);
  return (
    <Portal>
      <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && ui.closeCalendars()}>
        <div ref={ref} className="authcard wide" role="dialog" aria-modal="true" aria-label="Calendars" tabIndex={-1}>
          <b className="card-title">Calendars</b>
          <CalendarList />
          <CalendarForms onDone={ui.closeCalendars} />
        </div>
      </div>
    </Portal>
  );
}
