export const THEMES = ["light", "dark", "dim"] as const;
export type Theme = (typeof THEMES)[number];
/** What the person picked: a theme, or whatever the system prefers. */
export type ThemeChoice = Theme | "system";
export const CHOICES: readonly ThemeChoice[] = ["system", ...THEMES];
export const THEME_KEY = "orbyn-planner.theme";

export function isChoice(value: unknown): value is ThemeChoice {
  return typeof value === "string" && (CHOICES as readonly string[]).includes(value);
}

export function readStoredChoice(): ThemeChoice {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return isChoice(value) ? value : "system";
  } catch {
    return "system";
  }
}

function storeChoice(choice: ThemeChoice): void {
  try {
    localStorage.setItem(THEME_KEY, choice);
  } catch {
    // Storage can be blocked; the choice then lasts for this visit only.
  }
}

const DARK_QUERY = "(prefers-color-scheme: dark)";

export function systemTheme(): Theme {
  const dark = typeof window.matchMedia === "function" && window.matchMedia(DARK_QUERY).matches;
  return dark ? "dark" : "light";
}

export function resolveTheme(choice: ThemeChoice): Theme {
  return choice === "system" ? systemTheme() : choice;
}

export function applyChoice(choice: ThemeChoice): void {
  document.documentElement.dataset.theme = resolveTheme(choice);
}

export function chooseTheme(choice: ThemeChoice): void {
  storeChoice(choice);
  applyChoice(choice);
}

/** Follows the system while the choice is "system". Returns a function that stops. */
export function watchSystemTheme(): () => void {
  if (typeof window.matchMedia !== "function") return () => undefined;
  const query = window.matchMedia(DARK_QUERY);
  const onChange = () => {
    if (readStoredChoice() === "system") applyChoice("system");
  };
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
