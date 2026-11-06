/**
 * Wall-clock arithmetic on `YYYY-MM-DD` and `YYYY-MM-DDTHH:mm` values. It never touches the local
 * time zone, so a daylight-saving change cannot move a time of day or lose an hour.
 */

const DAY_MS = 86_400_000;
const pad = (n: number, w = 2) => String(n).padStart(w, "0");

function parts(value: string): { y: number; mo: number; d: number; h: number; mi: number; timed: boolean } {
  const [day = "", time] = value.split("T");
  const [y = 1970, mo = 1, d = 1] = day.split("-").map(Number);
  const [h = 0, mi = 0] = time ? time.split(":").map(Number) : [];
  return { y, mo, d, h, mi, timed: time !== undefined };
}

/** Days since 1970-01-01 of a date. */
export function dayNumber(day: string): number {
  const { y, mo, d } = parts(day);
  const t = new Date(0);
  t.setUTCFullYear(y, mo - 1, d);
  return Math.round(t.getTime() / DAY_MS);
}

function fromDayNumber(n: number): string {
  const t = new Date(n * DAY_MS);
  return `${pad(t.getUTCFullYear(), 4)}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** Minutes since the start of 1970-01-01 on the wall clock; a date alone is its midnight. */
export function wallMinutes(value: string): number {
  const p = parts(value);
  return dayNumber(value.slice(0, 10)) * 1440 + p.h * 60 + p.mi;
}

/** Calendar days between two dates (`b` minus `a`). */
export const daysBetween = (a: string, b: string): number => dayNumber(b.slice(0, 10)) - dayNumber(a.slice(0, 10));

/** Adds whole days and minutes on the wall clock. A date alone only moves by days. */
export function addWall(value: string, days: number, minutes = 0): string {
  const p = parts(value);
  if (!p.timed) return fromDayNumber(dayNumber(value) + days);
  const total = p.h * 60 + p.mi + minutes;
  const carry = Math.floor(total / 1440);
  const inDay = total - carry * 1440;
  return `${fromDayNumber(dayNumber(value.slice(0, 10)) + days + carry)}T${pad(Math.floor(inDay / 60))}:${pad(inDay % 60)}`;
}

/** An end at midnight ends the day before: a meeting to 00:00 does not touch the next day. */
export function lastDayOf(start: string, end: string, allDay: boolean): string {
  const last = end.slice(0, 10);
  if (!allDay && end.length > 10 && end.slice(11) === "00:00" && last > start.slice(0, 10)) return fromDayNumber(dayNumber(last) - 1);
  return last;
}

/** Whether something from `start` to `end` falls on `day`, an end at 00:00 being exclusive. */
export function touchesDay(o: { start: string; end: string; allDay: boolean }, day: string): boolean {
  return o.start.slice(0, 10) <= day && lastDayOf(o.start, o.end, o.allDay) >= day;
}
