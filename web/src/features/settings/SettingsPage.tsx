import { useState } from "react";
import { CHOICES, chooseTheme, readStoredChoice, type ThemeChoice } from "../../app/theme";
import { Icon } from "../../components/Icon";

const LABELS: Record<ThemeChoice, string> = { system: "System", light: "Light", dark: "Dark", dim: "Dim" };
const CATEGORIES = ["Account", "Planning", "Notifications", "Connected apps", "Calendars", "Privacy"] as const;

export function SettingsPage() {
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("Planning");
  const [find, setFind] = useState("");
  const [choice, setChoice] = useState<ThemeChoice>(readStoredChoice);
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
          ) : (
            <p className="quiet">Nothing to set here yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}
