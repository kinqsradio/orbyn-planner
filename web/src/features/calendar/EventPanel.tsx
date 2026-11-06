import { useMemo, useRef, useState } from "react";
import { useUi } from "../../app/ui";
import { Icon } from "../../components/Icon";
import { Portal } from "../../components/Portal";
import { PHONE_QUERY, useMediaQuery } from "../../components/useMediaQuery";
import { useDialog } from "../../components/useDialog";
import { usePlanner, useStore } from "../../store/context";
import { CannotMoveSeries, deleteOccurrence, duplicateOccurrence, editOccurrence, type Scope } from "../../store/eventScope";
import { expandEvents, repeatLabel, type Occurrence } from "../../store/occurrences";
import type { Person, Response } from "../../store/types";
import { REMINDERS, REPEAT_CHOICES, RESPONSE_LABELS, choiceOf, parsePeople, ruleOf, type RepeatChoice } from "./eventForm";
import { ScopeDialog } from "./ScopeDialog";

const timePart = (value: string) => (value.length > 10 ? value.slice(11, 16) : "");

function Panel({ occ }: { occ: Occurrence }) {
  const store = useStore();
  const { calendars } = usePlanner();
  const ui = useUi();
  const ref = useRef<HTMLElement>(null);
  const phone = useMediaQuery(PHONE_QUERY);
  useDialog(ref, ui.closeEvent, phone);

  const event = occ.event;
  const locked = event.readOnly;
  const calendar = calendars.find((c) => c.id === event.calendarId);

  const [title, setTitle] = useState(event.title);
  const [allDay, setAllDay] = useState(occ.allDay);
  const [startDay, setStartDay] = useState(occ.start.slice(0, 10));
  const [startTime, setStartTime] = useState(timePart(occ.start) || "09:00");
  const [endDay, setEndDay] = useState(occ.end.slice(0, 10));
  const [endTime, setEndTime] = useState(timePart(occ.end) || "10:00");
  const [calendarId, setCalendarId] = useState(event.calendarId);
  const [place, setPlace] = useState(event.place);
  const initialRepeat = choiceOf(event.repeat);
  const [repeat, setRepeat] = useState<RepeatChoice>(initialRepeat);
  const [reminder, setReminder] = useState<number | null>(event.reminder);
  const [people, setPeople] = useState<Person[]>(event.people);
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState(event.notes);
  const [ask, setAsk] = useState<null | "save" | "delete">(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const start = allDay ? startDay : `${startDay}T${startTime}`;
  const end = allDay ? endDay : `${endDay}T${endTime}`;
  const invalid = title.trim() === "" || end < start;
  const editable = useMemo(() => calendars.filter((c) => c.kind.type === "local" || c.id === event.calendarId), [calendars, event.calendarId]);

  const save = (scope: Scope) => {
    let created: ReturnType<typeof editOccurrence>;
    try {
      created = editOccurrence(store, occ, scope, {
        title: title.trim(),
        allDay,
        start,
        end,
        calendarId,
        place: place.trim(),
        notes,
        people,
        reminder,
        // Only a changed repeat is sent; the same one must not reset the dates skipped from it.
        repeat: repeat === initialRepeat ? undefined : ruleOf(repeat),
      });
    } catch (e) {
      // A move the repeat cannot say: nothing was changed, and the person is told why.
      setAsk(null);
      setSaveError(e instanceof CannotMoveSeries ? e.message : "Couldn’t save that change.");
      return;
    }
    setAsk(null);
    setSaveError(null);
    ui.openEvent(created?.id ?? event.id, startDay);
    ui.showToast("Event saved");
  };

  const remove = (scope: Scope) => {
    const undo = deleteOccurrence(store, occ, scope);
    setAsk(null);
    ui.closeEvent();
    ui.showToast("Event deleted", undo);
  };

  const duplicate = () => {
    const copy = duplicateOccurrence(store, occ);
    ui.openEvent(copy.id, copy.start.slice(0, 10));
    ui.showToast("Event duplicated");
  };

  const panel = (
    <aside ref={ref} className="task-panel" role={phone ? "dialog" : "complementary"} aria-modal={phone ? "true" : undefined} aria-label="Event" tabIndex={-1}>
      <div className="tp-head">
        <span className="sw" style={{ background: `var(--${calendar?.colour ?? "c1"})` }} aria-hidden="true" />
        <input className="tp-title" aria-label="Title" value={title} data-autofocus disabled={locked} onChange={(e) => setTitle(e.target.value)} />
        <button type="button" className="icon-btn" aria-label="Close" onClick={ui.closeEvent}>
          <Icon name="x" />
        </button>
      </div>
      {locked && <p className="t3">From the subscribed calendar “{calendar?.name}”. It can’t be changed here.</p>}

      <div className="kv"><span>All day</span><b className="ctl"><input type="checkbox" className="check" aria-label="All day" checked={allDay} disabled={locked} onChange={(e) => setAllDay(e.target.checked)} /></b></div>
      <div className="kv">
        <span>Starts</span>
        <b className="ctl">
          <input className="inp" type="date" aria-label="Start date" value={startDay} disabled={locked} onChange={(e) => setStartDay(e.target.value)} />
          {!allDay && <input className="inp" type="time" aria-label="Start time" value={startTime} disabled={locked} onChange={(e) => setStartTime(e.target.value)} />}
        </b>
      </div>
      <div className="kv">
        <span>Ends</span>
        <b className="ctl">
          <input className="inp" type="date" aria-label="End date" value={endDay} disabled={locked} onChange={(e) => setEndDay(e.target.value)} />
          {!allDay && <input className="inp" type="time" aria-label="End time" value={endTime} disabled={locked} onChange={(e) => setEndTime(e.target.value)} />}
        </b>
      </div>
      {end < start && <p className="err">It ends before it starts.</p>}
      <div className="kv">
        <span>Calendar</span>
        <b className="ctl">
          <select className="inp" aria-label="Calendar" value={calendarId} disabled={locked} onChange={(e) => setCalendarId(e.target.value)}>
            {editable.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </b>
      </div>
      <div className="kv">
        <span>Where</span>
        <b className="ctl"><input className="inp" aria-label="Where" value={place} disabled={locked} onChange={(e) => setPlace(e.target.value)} /></b>
      </div>
      <div className="kv">
        <span>Repeat</span>
        <b className="ctl">
          <select className="inp" aria-label="Repeat" value={repeat} disabled={locked} onChange={(e) => setRepeat(e.target.value as RepeatChoice)}>
            {repeat === "keep" && <option value="keep">{repeatLabel(event.repeat)}</option>}
            {REPEAT_CHOICES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </b>
      </div>
      <div className="kv">
        <span>Reminder</span>
        <b className="ctl">
          <select className="inp" aria-label="Reminder" value={reminder ?? ""} disabled={locked} onChange={(e) => setReminder(e.target.value === "" ? null : Number(e.target.value))}>
            {REMINDERS.map((r) => (
              <option key={r.label} value={r.value ?? ""}>{r.label}</option>
            ))}
          </select>
        </b>
      </div>

      {!locked || people.length > 0 ? (
        <>
          <div className="bh"><b>People</b><span>{people.length || ""}</span></div>
          <ul>
            {people.map((p) => (
              <li className="kv person-row" key={p.email}>
                <span>{p.email}</span>
                <b className={p.response === "none" ? "t3" : undefined}>
                  <select className="inp" aria-label={`Reply from ${p.email}`} value={p.response} disabled={locked} onChange={(e) => setPeople(people.map((q) => (q === p ? { ...q, response: e.target.value as Response } : q)))}>
                    {(Object.keys(RESPONSE_LABELS) as Response[]).map((r) => (
                      <option key={r} value={r}>{RESPONSE_LABELS[r]}</option>
                    ))}
                  </select>
                  {!locked && (
                    <button type="button" className="icon-btn" aria-label={`Remove ${p.email}`} onClick={() => setPeople(people.filter((q) => q !== p))}>
                      <Icon name="x" small />
                    </button>
                  )}
                </b>
              </li>
            ))}
          </ul>
          {!locked && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setPeople(parsePeople(email, people));
                setEmail("");
              }}
            >
              <input className="field" aria-label="Add a person" placeholder="Add by email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </form>
          )}
        </>
      ) : null}

      <div className="bh"><b>Notes</b><span></span></div>
      <textarea className="field notes" aria-label="Notes" rows={4} value={notes} disabled={locked} onChange={(e) => setNotes(e.target.value)} />

      {saveError && <p className="err" role="alert">{saveError}</p>}
      <div className="tp-foot">
        {!locked && <button type="button" className="ghost danger" onClick={() => (event.repeat ? setAsk("delete") : remove("all"))}>Delete</button>}
        <button type="button" className="ghost" onClick={duplicate}>Duplicate</button>
        {!locked && (
          <button type="button" className="btn" disabled={invalid} onClick={() => (event.repeat ? setAsk("save") : save("all"))}>
            Save
          </button>
        )}
      </div>

      {ask && <ScopeDialog title={ask === "save" ? "Save changes to" : "Delete"} onCancel={() => setAsk(null)} onChoose={(scope) => (ask === "save" ? save(scope) : remove(scope))} />}
    </aside>
  );
  return phone ? <Portal>{panel}</Portal> : panel;
}

export function EventPanel() {
  const { events } = usePlanner();
  const { eventKey } = useUi();
  const occ = useMemo(() => {
    if (!eventKey) return null;
    const event = events.find((e) => e.id === eventKey.id && e.deletedAt === null);
    return event ? (expandEvents([event], eventKey.date, eventKey.date).find((o) => o.date === eventKey.date) ?? null) : null;
  }, [events, eventKey]);
  // A fresh form for each occurrence and each saved version of the event.
  return occ ? <Panel key={`${occ.event.id}-${occ.date}-${occ.event.updatedAt}`} occ={occ} /> : null;
}
