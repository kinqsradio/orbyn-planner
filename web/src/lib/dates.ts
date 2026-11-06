export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
export const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

const pad = (n: number) => String(n).padStart(2, "0");

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes());
}

/** Monday 00:00 of the week containing `d`. */
export function startOfWeek(d: Date): Date {
  const back = (d.getDay() + 6) % 7;
  return addDays(startOfDay(d), -back);
}

export function dateKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** A due value: `YYYY-MM-DD` for a day, `YYYY-MM-DDTHH:mm` for a time, both local. */
export function makeDue(d: Date, withTime: boolean): string {
  return withTime ? `${dateKey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}` : dateKey(d);
}

export interface ParsedDue {
  date: Date;
  hasTime: boolean;
}

export function parseDue(due: string): ParsedDue {
  const [day = "", time] = due.split("T");
  const [y = 1970, m = 1, d = 1] = day.split("-").map(Number);
  const [h = 0, min = 0] = time ? time.split(":").map(Number) : [];
  return { date: new Date(y, m - 1, d, h, min), hasTime: time !== undefined };
}

export function dueDayKey(due: string): string {
  return due.slice(0, 10);
}

export function isDueToday(due: string, now: Date): boolean {
  return dueDayKey(due) === dateKey(now);
}

export function isOverdue(due: string, now: Date): boolean {
  const { date, hasTime } = parseDue(due);
  return hasTime ? date.getTime() < now.getTime() : date.getTime() < startOfDay(now).getTime();
}

/** Orders by due; no due date last. */
export function compareDue(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return parseDue(a).date.getTime() - parseDue(b).date.getTime();
}

export function formatTime(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatDue(due: string, now: Date): string {
  const { date, hasTime } = parseDue(due);
  const diff = Math.round((startOfDay(date).getTime() - startOfDay(now).getTime()) / 86_400_000);
  let day: string;
  if (diff === 0) day = "Today";
  else if (diff === 1) day = "Tomorrow";
  else if (diff === -1) day = "Yesterday";
  else if (diff > 1 && diff < 7) day = WEEKDAYS[date.getDay()]!.slice(0, 3);
  else {
    day = `${date.getDate()} ${MONTHS[date.getMonth()]!.slice(0, 3)}`;
    if (date.getFullYear() !== now.getFullYear()) day += ` ${date.getFullYear()}`;
  }
  return hasTime ? `${day} ${formatTime(date)}` : day;
}

/** "Fri 13 Nov 15:00", with the year when it is not this year. */
export function formatDueLong(due: string, now: Date): string {
  const { date, hasTime } = parseDue(due);
  let out = `${WEEKDAYS[date.getDay()]!.slice(0, 3)} ${date.getDate()} ${MONTHS[date.getMonth()]!.slice(0, 3)}`;
  if (date.getFullYear() !== now.getFullYear()) out += ` ${date.getFullYear()}`;
  return hasTime ? `${out} ${formatTime(date)}` : out;
}
