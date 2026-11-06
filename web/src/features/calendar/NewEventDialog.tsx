import { useRef, useState } from "react";
import { useNow } from "../../app/clock";
import { useUi } from "../../app/ui";
import { Portal } from "../../components/Portal";
import { useDialog } from "../../components/useDialog";
import { dateKey } from "../../lib/dates";
import { usePlanner, useStore } from "../../store/context";
import { REMINDERS, REPEAT_CHOICES, parsePeople, ruleOf, type RepeatChoice } from "./eventForm";

const pad = (n: number) => String(n).padStart(2, "0");

/** The "New event" card: title and when first, then calendar, repeat, reminder and people. */
export function NewEventDialog() {
  const store = useStore();
  const { calendars } = usePlanner();
  const ui = useUi();
  const now = useNow();
  const ref = useRef<HTMLDivElement>(null);
  useDialog(ref, ui.closeNewEvent);

  const nextHour = Math.min(now.getHours() + 1, 22);
  const [title, setTitle] = useState("");
  const [allDay, setAllDay] = useState(false);
  const [day, setDay] = useState(ui.newEventDate || dateKey(now));
  const [startTime, setStartTime] = useState(`${pad(nextHour)}:00`);
  const [endTime, setEndTime] = useState(`${pad(nextHour + 1)}:00`);
  const writable = calendars.filter((c) => c.kind.type === "local");
  const [calendarId, setCalendarId] = useState(writable[0]?.id ?? "");
  const [repeat, setRepeat] = useState<RepeatChoice>("never");
  const [reminder, setReminder] = useState<number | null>(null);
  const [people, setPeople] = useState("");

  const bad = title.trim() === "" || (!allDay && endTime < startTime);

  const submit = () => {
    if (bad) return;
    const event = store.addEvent({
      title,
      calendarId,
      allDay,
      start: allDay ? day : `${day}T${startTime}`,
      end: allDay ? day : `${day}T${endTime}`,
      reminder,
      people: parsePeople(people),
      repeat: ruleOf(repeat) ?? null,
    });
    ui.closeNewEvent();
    ui.showToast(`Added “${event.title}”`);
  };

  return (
    <Portal>
      <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && ui.closeNewEvent()}>
        <div ref={ref} className="authcard" style={{ width: 480 }} role="dialog" aria-modal="true" aria-label="New event" tabIndex={-1}>
          <b className="card-title">New event</b>
          <form
            className="form"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <label htmlFor="ne-title">Title</label>
            <input id="ne-title" className="field" data-autofocus value={title} onChange={(e) => setTitle(e.target.value)} />
            <label htmlFor="ne-day">When</label>
            <div className="two">
              <input id="ne-day" className="field" type="date" value={day} onChange={(e) => setDay(e.target.value)} />
              {!allDay && <input className="field" type="time" aria-label="Start time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />}
              {!allDay && <input className="field" type="time" aria-label="End time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />}
            </div>
            <label className="check-row">
              <input type="checkbox" className="check" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
              All day
            </label>
            {!allDay && endTime < startTime && <p className="err">It ends before it starts.</p>}
            <label htmlFor="ne-cal">Calendar</label>
            <select id="ne-cal" className="field" value={calendarId} onChange={(e) => setCalendarId(e.target.value)}>
              {writable.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <div className="kv">
              <label htmlFor="ne-repeat">Repeat</label>
              <b className="ctl">
                <select id="ne-repeat" className="inp" value={repeat} onChange={(e) => setRepeat(e.target.value as RepeatChoice)}>
                  {REPEAT_CHOICES.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </b>
            </div>
            <div className="kv">
              <label htmlFor="ne-reminder">Reminder</label>
              <b className="ctl">
                <select id="ne-reminder" className="inp" value={reminder ?? ""} onChange={(e) => setReminder(e.target.value === "" ? null : Number(e.target.value))}>
                  {REMINDERS.map((r) => (
                    <option key={r.label} value={r.value ?? ""}>{r.label}</option>
                  ))}
                </select>
              </b>
            </div>
            <label htmlFor="ne-people">Invite people</label>
            <input id="ne-people" className="field" placeholder="Add by email" value={people} onChange={(e) => setPeople(e.target.value)} />
            <div className="dialog-actions">
              <button type="button" className="ghost" onClick={ui.closeNewEvent}>Cancel</button>
              <button type="submit" className="btn" disabled={bad}>Add event</button>
            </div>
          </form>
        </div>
      </div>
    </Portal>
  );
}
