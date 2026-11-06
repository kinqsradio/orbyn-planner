/** Time zones in iCalendar feeds, read into the viewer's local time. */

/** Windows time zone names, as Outlook writes them, and the IANA zones they stand for. */
const WINDOWS_ZONES: Record<string, string> = {
  "Dateline Standard Time": "Etc/GMT+12",
  "Hawaiian Standard Time": "Pacific/Honolulu",
  "Alaskan Standard Time": "America/Anchorage",
  "Pacific Standard Time": "America/Los_Angeles",
  "US Mountain Standard Time": "America/Phoenix",
  "Mountain Standard Time": "America/Denver",
  "Central Standard Time": "America/Chicago",
  "Central America Standard Time": "America/Guatemala",
  "Canada Central Standard Time": "America/Regina",
  "Eastern Standard Time": "America/New_York",
  "US Eastern Standard Time": "America/Indianapolis",
  "SA Pacific Standard Time": "America/Bogota",
  "Atlantic Standard Time": "America/Halifax",
  "Newfoundland Standard Time": "America/St_Johns",
  "E. South America Standard Time": "America/Sao_Paulo",
  "Argentina Standard Time": "America/Argentina/Buenos_Aires",
  "SA Western Standard Time": "America/La_Paz",
  "Greenwich Standard Time": "Atlantic/Reykjavik",
  "GMT Standard Time": "Europe/London",
  "UTC": "UTC",
  "W. Europe Standard Time": "Europe/Berlin",
  "Central Europe Standard Time": "Europe/Budapest",
  "Central European Standard Time": "Europe/Warsaw",
  "Romance Standard Time": "Europe/Paris",
  "W. Central Africa Standard Time": "Africa/Lagos",
  "E. Europe Standard Time": "Europe/Chisinau",
  "FLE Standard Time": "Europe/Kiev",
  "GTB Standard Time": "Europe/Bucharest",
  "Turkey Standard Time": "Europe/Istanbul",
  "Israel Standard Time": "Asia/Jerusalem",
  "Egypt Standard Time": "Africa/Cairo",
  "South Africa Standard Time": "Africa/Johannesburg",
  "Russian Standard Time": "Europe/Moscow",
  "Arabian Standard Time": "Asia/Dubai",
  "Arab Standard Time": "Asia/Riyadh",
  "Iran Standard Time": "Asia/Tehran",
  "Pakistan Standard Time": "Asia/Karachi",
  "India Standard Time": "Asia/Calcutta",
  "Bangladesh Standard Time": "Asia/Dhaka",
  "SE Asia Standard Time": "Asia/Bangkok",
  "China Standard Time": "Asia/Shanghai",
  "Singapore Standard Time": "Asia/Singapore",
  "W. Australia Standard Time": "Australia/Perth",
  "Taipei Standard Time": "Asia/Taipei",
  "Tokyo Standard Time": "Asia/Tokyo",
  "Korea Standard Time": "Asia/Seoul",
  "Cen. Australia Standard Time": "Australia/Adelaide",
  "AUS Central Standard Time": "Australia/Darwin",
  "E. Australia Standard Time": "Australia/Brisbane",
  "AUS Eastern Standard Time": "Australia/Sydney",
  "Tasmania Standard Time": "Australia/Hobart",
  "West Pacific Standard Time": "Pacific/Port_Moresby",
  "New Zealand Standard Time": "Pacific/Auckland",
  // Outlook's other common names.
  "Central Standard Time (Mexico)": "America/Mexico_City",
  "Mountain Standard Time (Mexico)": "America/Mazatlan",
  "Pacific Standard Time (Mexico)": "America/Tijuana",
  "Eastern Standard Time (Mexico)": "America/Cancun",
  "Aleutian Standard Time": "America/Adak",
  "Venezuela Standard Time": "America/Caracas",
  "Central Brazilian Standard Time": "America/Cuiaba",
  "Pacific SA Standard Time": "America/Santiago",
  "Paraguay Standard Time": "America/Asuncion",
  "Montevideo Standard Time": "America/Montevideo",
  "SA Eastern Standard Time": "America/Cayenne",
  "Bahia Standard Time": "America/Bahia",
  "Greenland Standard Time": "America/Godthab",
  "Cuba Standard Time": "America/Havana",
  "Haiti Standard Time": "America/Port-au-Prince",
  "Azores Standard Time": "Atlantic/Azores",
  "Cape Verde Standard Time": "Atlantic/Cape_Verde",
  "Morocco Standard Time": "Africa/Casablanca",
  "Namibia Standard Time": "Africa/Windhoek",
  "E. Africa Standard Time": "Africa/Nairobi",
  "Jordan Standard Time": "Asia/Amman",
  "Middle East Standard Time": "Asia/Beirut",
  "Syria Standard Time": "Asia/Damascus",
  "Arabic Standard Time": "Asia/Baghdad",
  "Belarus Standard Time": "Europe/Minsk",
  "Kaliningrad Standard Time": "Europe/Kaliningrad",
  "Georgian Standard Time": "Asia/Tbilisi",
  "Caucasus Standard Time": "Asia/Yerevan",
  "Azerbaijan Standard Time": "Asia/Baku",
  "Afghanistan Standard Time": "Asia/Kabul",
  "West Asia Standard Time": "Asia/Tashkent",
  "Sri Lanka Standard Time": "Asia/Colombo",
  "Nepal Standard Time": "Asia/Katmandu",
  "Central Asia Standard Time": "Asia/Almaty",
  "Myanmar Standard Time": "Asia/Rangoon",
  "N. Central Asia Standard Time": "Asia/Novosibirsk",
  "North Asia Standard Time": "Asia/Krasnoyarsk",
  "Ulaanbaatar Standard Time": "Asia/Ulaanbaatar",
  "Yakutsk Standard Time": "Asia/Yakutsk",
  "Vladivostok Standard Time": "Asia/Vladivostok",
  "Magadan Standard Time": "Asia/Magadan",
  "Mauritius Standard Time": "Indian/Mauritius",
  "Fiji Standard Time": "Pacific/Fiji",
  "Tonga Standard Time": "Pacific/Tongatapu",
  "Samoa Standard Time": "Pacific/Apia",
  "Marquesas Standard Time": "Pacific/Marquesas",
  "Lord Howe Standard Time": "Australia/Lord_Howe",
  "Mid-Atlantic Standard Time": "Etc/GMT+2",
  "UTC-11": "Etc/GMT+11",
  "UTC-02": "Etc/GMT+2",
  "UTC+12": "Etc/GMT-12",
  "Coordinated Universal Time": "UTC",
};

const formatters = new Map<string, Intl.DateTimeFormat | null>();

function formatterFor(zone: string): Intl.DateTimeFormat | null {
  if (formatters.has(zone)) return formatters.get(zone)!;
  let f: Intl.DateTimeFormat | null;
  try {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
  } catch {
    f = null;
  }
  formatters.set(zone, f);
  return f;
}

/** The IANA name for a TZID: itself if the browser knows it, or what a Windows name stands for. Null when unknown. */
export function resolveZone(tzid: string): string | null {
  const name = tzid.replace(/^"|"$/g, "").trim();
  if (name === "") return null;
  if (formatterFor(name)) return name;
  const mapped = WINDOWS_ZONES[name];
  return mapped && formatterFor(mapped) ? mapped : null;
}

/** How far ahead of UTC a zone is at an instant, in minutes. */
function offsetMinutes(zone: string, at: number): number {
  const parts = formatterFor(zone)!.formatToParts(new Date(at));
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  const wall = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((wall - Math.floor(at / 1000) * 1000) / 60_000);
}

/**
 * The instant a wall-clock time has in a zone, as a Date, or null if the zone is unknown. When the
 * clocks go back a time happens twice and the first is taken; when they go forward a time does not
 * happen and the offset from before the change is used, as most calendars do.
 */
export function zonedInstant(zone: string, y: number, mo: number, d: number, h: number, mi: number): Date | null {
  if (!formatterFor(zone)) return null;
  const guess = new Date(0);
  guess.setUTCFullYear(y, mo - 1, d);
  guess.setUTCHours(h, mi, 0, 0);
  const asUtc = guess.getTime();
  const DAY = 86_400_000;
  const before = offsetMinutes(zone, asUtc - DAY);
  const after = offsetMinutes(zone, asUtc + DAY);
  const candidates = [...new Set([before, after])].map((off) => asUtc - off * 60_000);
  const valid = candidates.filter((c) => asUtc - offsetMinutes(zone, c) * 60_000 === c);
  if (valid.length > 0) return new Date(Math.min(...valid));
  return new Date(asUtc - before * 60_000);
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** A wall-clock time (`YYYY-MM-DDTHH:mm`) in a zone, as the same moment on the viewer's wall clock. Null if the zone is unknown. */
export function wallToLocal(zone: string, wall: string): string | null {
  const y = Number(wall.slice(0, 4));
  const instant = zonedInstant(zone, y, Number(wall.slice(5, 7)), Number(wall.slice(8, 10)), Number(wall.slice(11, 13)), Number(wall.slice(14, 16)));
  if (!instant) return null;
  return `${pad(instant.getFullYear(), 4)}-${pad(instant.getMonth() + 1)}-${pad(instant.getDate())}T${pad(instant.getHours())}:${pad(instant.getMinutes())}`;
}

/** An instant as a wall-clock time in a zone. Null if the zone is unknown. */
export function instantToWall(zone: string, at: Date): string | null {
  const f = formatterFor(zone);
  if (!f) return null;
  const parts = f.formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  return `${pad(get("year"), 4)}-${pad(get("month"))}-${pad(get("day"))}T${pad(get("hour"))}:${pad(get("minute"))}`;
}
