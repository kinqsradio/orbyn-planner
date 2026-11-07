/**
 * localStorage for what the account screens remember (the protection notice, what was read), with a switch: while an account's keys
 * are held in this tab's memory only, nothing about it may reach storage, so reads and writes go to a map that goes with the tab.
 */
const held = new Map<string, string>();
const holders = new Set<symbol>();
let memoryOnly = false;

/** Starts keeping everything in memory, until the returned function is called; several holders may overlap (the last to let go ends it). */
export function holdMemoryOnly(): () => void {
  const token = Symbol("memory-only");
  holders.add(token);
  memoryOnly = true;
  return () => {
    holders.delete(token);
    memoryOnly = holders.size > 0;
    if (!memoryOnly) held.clear();
  };
}

/** For tests: switch it on or off outright. */
export function setMemoryOnly(on: boolean): void {
  holders.clear();
  memoryOnly = on;
  if (on) holders.add(Symbol("memory-only"));
  else held.clear();
}

/** Whether the account's keys are held in this tab's memory only, so nothing may be written to storage. */
export const isMemoryOnly = (): boolean => memoryOnly;

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
