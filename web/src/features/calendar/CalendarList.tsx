import { useState } from "react";
import { formatTime } from "../../lib/dates";
import { usePlanner, useStore } from "../../store/context";
import { LIST_COLOURS, type ListColour, type PlannerCalendar } from "../../store/types";
import { Swatch } from "../tasks/TaskRow";
import { NEEDS_ENGINE } from "../../api/feeds";
import { FeedError, feedAddress, refreshCalendar, subscriptionsAvailable } from "./subscriptions";

const COLOUR_NAMES: Record<ListColour, string> = { c1: "Blue", c2: "Green", c3: "Purple", c4: "Orange" };

function Row({ calendar }: { calendar: PlannerCalendar }) {
  const store = useStore();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(calendar.name);
  const feed = calendar.kind.type === "subscribed" ? calendar.kind : null;

  const save = () => {
    const next = name.trim();
    if (next && next !== calendar.name) store.updateCalendar(calendar.id, { name: next });
    setRenaming(false);
  };

  return (
    <li className="cal-row">
      <div className="kv" style={{ height: 40 }}>
        {renaming ? (
          <form
            style={{ flex: 1 }}
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <input className="inp" aria-label="Calendar name" value={name} autoFocus onChange={(e) => setName(e.target.value)} onBlur={save} />
          </form>
        ) : (
          <span className="tag" style={{ color: "var(--t1)" }}>
            <Swatch colour={calendar.colour} />
            {calendar.name}
            {feed && <span className="t3"> · subscribed</span>}
          </span>
        )}
        <b className="ctl">
          <span role="radiogroup" aria-label={`Colour of ${calendar.name}`} className="colours">
            {LIST_COLOURS.map((c) => (
              <button key={c} type="button" role="radio" aria-checked={calendar.colour === c} aria-label={COLOUR_NAMES[c]} className="colour-btn" onClick={() => store.updateCalendar(calendar.id, { colour: c })}>
                <Swatch colour={c} />
              </button>
            ))}
          </span>
          {!renaming && (
            <button type="button" className="ghost" onClick={() => { setName(calendar.name); setRenaming(true); }}>
              Rename
            </button>
          )}
          <button
            type="button"
            className="pill"
            aria-pressed={calendar.visible}
            aria-label={`${calendar.visible ? "Hide" : "Show"} ${calendar.name}`}
            onClick={() => store.updateCalendar(calendar.id, { visible: !calendar.visible })}
          >
            {calendar.visible ? "Shown" : "Hidden"}
          </button>
        </b>
      </div>
      {feed && (
        <div className="feed-status">
          {feed.error ? (
            <>
              <button type="button" className="link-btn red-text" onClick={() => void refreshCalendar(store, calendar)}>
                Couldn’t refresh · Retry
              </button>
              <span className="t3">{feed.error}</span>
            </>
          ) : (
            <span className="t3">{feed.lastRefreshed ? `Refreshed ${formatTime(new Date(feed.lastRefreshed))}` : "Not read yet"}</span>
          )}
        </div>
      )}
    </li>
  );
}

/** Every calendar, with its colour, name and whether it is shown. Subscribed ones show their refresh state. */
export function CalendarList() {
  const { calendars } = usePlanner();
  return (
    <ul className="cal-list" aria-label="Calendars">
      {calendars.map((c) => (
        <Row key={c.id} calendar={c} />
      ))}
    </ul>
  );
}

/** The forms to add a calendar or subscribe to one. */
export function CalendarForms({ onDone }: { onDone?: () => void }) {
  const store = useStore();
  const { calendars } = usePlanner();
  const [mode, setMode] = useState<null | "new" | "subscribe">(null);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const colour = LIST_COLOURS[calendars.length % LIST_COLOURS.length]!;

  const reset = () => {
    setMode(null);
    setName("");
    setUrl("");
    setProblem(null);
  };

  return (
    <>
      {mode === null ? (
        <div className="dialog-actions">
          <button type="button" className="ghost" disabled={!subscriptionsAvailable()} onClick={() => setMode("subscribe")}>Subscribe to a calendar</button>
          {!subscriptionsAvailable() && <p className="t3" role="note">{NEEDS_ENGINE}.</p>}
          <button type="button" className="btn" onClick={() => setMode("new")}>New calendar</button>
          {onDone && <button type="button" className="ghost" onClick={onDone}>Done</button>}
        </div>
      ) : (
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            const title = name.trim();
            if (!title || (mode === "subscribe" && !url.trim())) return;
            if (mode === "new") store.addCalendar(title, colour);
            else {
              try {
                feedAddress(url);
              } catch (error) {
                setProblem(error instanceof FeedError ? error.message : "That link doesn’t work.");
                return;
              }
              const calendar = store.addSubscription(title, colour, url.trim());
              void refreshCalendar(store, calendar);
            }
            reset();
          }}
        >
          <label htmlFor="cal-name">Name</label>
          <input id="cal-name" className="field" value={name} autoFocus onChange={(e) => setName(e.target.value)} />
          {mode === "subscribe" && (
            <>
              <label htmlFor="cal-url">Subscribe by link</label>
              <input id="cal-url" className="field" type="url" placeholder="https://example.com/holidays.ics" value={url} onChange={(e) => setUrl(e.target.value)} aria-describedby={problem ? "cal-url-problem" : undefined} />
              {problem && <p id="cal-url-problem" className="err" role="alert">{problem}</p>}
            </>
          )}
          <div className="dialog-actions">
            <button type="button" className="ghost" onClick={reset}>Cancel</button>
            <button type="submit" className="btn">{mode === "new" ? "Add calendar" : "Subscribe"}</button>
          </div>
        </form>
      )}
    </>
  );
}
