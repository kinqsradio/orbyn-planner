import { useState } from "react";
import { CHOICES, chooseTheme, readStoredChoice, type ThemeChoice } from "../../app/theme";
import { usePrefs } from "../../app/prefs";
import { Icon } from "../../components/Icon";
import { CalendarForms, CalendarList } from "../calendar/CalendarList";
import { AccountSettings } from "../auth/AccountSettings";
import { NotificationsSettings } from "./NotificationsSettings";

const LABELS: Record<ThemeChoice, string> = { system: "System", light: "Light", dark: "Dark", dim: "Dim" };
const CATEGORIES = ["Account", "Planning", "Notifications", "Connected apps", "Calendars", "Privacy"] as const;

export function SettingsPage() {
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("Planning");
  const [find, setFind] = useState("");
  const [choice, setChoice] = useState<ThemeChoice>(readStoredChoice);
  const { prefs, setPrefs } = usePrefs();
  const shown = CATEGORIES.filter((c) => c.toLowerCase().includes(find.trim().toLowerCase()));

  return (
    <div className="split">
      <div className="l">
        <label className="search">
          <Icon name="search" small />
          <input placeholder="Find a setting" aria-label="Find a setting" value={find} onChange={(e) => setFind(e.target.value)} />
        </label>
        {shown.map((c) => (
          <button key={c} type="button" className={c === category ? "nav on" : "nav"} aria-current={c === category ? "true" : undefined} onClick={() => setCategory(c)}>
            {c}
          </button>
        ))}
      </div>
      <div className="r">
        <h1 className="sr-only">Settings</h1>
        <div className="ph">
          <h2>{category}</h2>
        </div>
        <div className="pad">
          {category === "Planning" ? (
            <>
              <div className="bh"><b>Your week</b><span></span></div>
              <div className="card" style={{ gap: 0, padding: "0 14px" }}>
                <div className="kv" style={{ height: 44, borderBottom: "1px solid var(--line)" }}>
                  <span id="week-start-label">Week starts on</span>
                  <div role="radiogroup" aria-labelledby="week-start-label" className="pills">
                    {(["mon", "sun"] as const).map((d) => (
                      <button key={d} type="button" role="radio" aria-checked={prefs.weekStart === d} className="pill" onClick={() => setPrefs({ weekStart: d })}>
                        {d === "mon" ? "Monday" : "Sunday"}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="kv" style={{ height: 44 }}>
                  <span id="week-days-label">Days in the week view</span>
                  <div role="radiogroup" aria-labelledby="week-days-label" className="pills">
                    {([5, 7] as const).map((n) => (
                      <button key={n} type="button" role="radio" aria-checked={prefs.weekDays === n} className="pill" onClick={() => setPrefs({ weekDays: n })}>
                        {n} days
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="bh"><b>Appearance</b><span></span></div>
              <div className="card" style={{ gap: 0, padding: "0 14px" }}>
                <div className="kv" style={{ height: 44 }}>
                  <span id="theme-label">Theme</span>
                  <div role="radiogroup" aria-labelledby="theme-label" className="pills">
                    {CHOICES.map((c) => (
                      <button
                        key={c}
                        type="button"
                        role="radio"
                        aria-checked={choice === c}
                        className="pill"
                        onClick={() => {
                          setChoice(c);
                          chooseTheme(c);
                        }}
                      >
                        {LABELS[c]}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </>
          ) : category === "Account" ? (
            <AccountSettings />
          ) : category === "Notifications" ? (
            <NotificationsSettings />
          ) : category === "Calendars" ? (
            <>
              <div className="bh"><b>Your calendars</b><span></span></div>
              <div className="card" style={{ gap: 0, padding: "0 14px" }}>
                <CalendarList />
              </div>
              <CalendarForms />
              <span className="t3" style={{ fontSize: 12.5 }}>
                Subscribed calendars are read from their link in this browser, once an hour while Orbyn Planner is open. Some servers don’t allow that yet.
              </span>
            </>
          ) : (
            <p className="quiet">Nothing to set here yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}
