/** Where Settings opens next: a screen that sends the person to a category (a notification, say) says so here, and Settings takes it once. */
let target: string | null = null;
export const setSettingsTarget = (category: string) => void (target = category);
export function takeSettingsTarget(): string | null {
  const t = target;
  target = null;
  return t;
}
