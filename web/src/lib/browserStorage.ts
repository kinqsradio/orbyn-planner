/**
 * localStorage for what the account screens remember (the protection notice, what was read), with a switch: while an account's keys
 * are held in this tab's memory only, nothing about it may reach storage, so reads and writes go to a map that goes with the tab.
 */
const held = new Map<string, string>();
let memoryOnly = false;

export function setMemoryOnly(on: boolean): void {
  memoryOnly = on;
  if (!on) held.clear();
}

export const browserStorage = {
  get(key: string): string | null {
    if (memoryOnly) return held.get(key) ?? null;
    return localStorage.getItem(key);
  },
  set(key: string, value: string): void {
    if (memoryOnly) held.set(key, value);
    else localStorage.setItem(key, value);
  },
  remove(key: string): void {
    held.delete(key);
    localStorage.removeItem(key);
  },
};
