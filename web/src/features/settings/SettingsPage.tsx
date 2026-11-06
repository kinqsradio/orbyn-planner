import { useState } from "react";
import { PageHeader } from "../../components/EmptyState";
import { chooseTheme, THEMES, type Theme, initialTheme, isTheme } from "../../app/theme";

const LABELS: Record<Theme, string> = { light: "Light", dark: "Dark", dim: "Dim" };

export function SettingsPage() {
  const [theme, setTheme] = useState<Theme>(() => {
    const current = document.documentElement.dataset.theme;
    return isTheme(current) ? current : initialTheme();
  });

  return (
    <>
      <PageHeader title="Settings" />
      <section aria-labelledby="appearance">
        <h2 id="appearance" className="section-title">Appearance</h2>
        <div role="radiogroup" aria-labelledby="appearance" className="segmented">
          {THEMES.map((t) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={theme === t}
              className="segment"
              onClick={() => {
                setTheme(t);
                chooseTheme(t);
              }}
            >
              {LABELS[t]}
            </button>
          ))}
        </div>
      </section>
    </>
  );
}
