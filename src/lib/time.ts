/**
 * Time-zone helpers without external libraries. Each restaurant location has an IANA time
 * zone (Europe/Lisbon for Casa de Marrocos); business days and slots are computed there.
 */

/** Offset in minutes between UTC and `timeZone` at the instant `date` (positive east of UTC). */
export function zoneOffsetMinutes(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

/** Calendar parts of `date` as seen in `timeZone`. */
export function zonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')),
    minute: Number(get('minute')),
    weekday: weekdays.indexOf(get('weekday')),
  };
}

/** Converts a wall-clock time in `timeZone` to a UTC Date (handles DST transitions). */
export function zonedTimeToUtc(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): Date {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const offset1 = zoneOffsetMinutes(guess, timeZone);
  const candidate = new Date(guess.getTime() - offset1 * 60000);
  const offset2 = zoneOffsetMinutes(candidate, timeZone);
  return offset1 === offset2 ? candidate : new Date(guess.getTime() - offset2 * 60000);
}

export function startOfDayInZone(date: Date, timeZone: string): Date {
  const p = zonedParts(date, timeZone);
  return zonedTimeToUtc(p.year, p.month, p.day, 0, 0, timeZone);
}

export function formatTimeInZone(date: Date, timeZone: string, localeTag = 'pt-PT'): string {
  return new Intl.DateTimeFormat(localeTag, { timeZone, hour: '2-digit', minute: '2-digit' }).format(date);
}

export function formatDateTimeInZone(date: Date, timeZone: string, localeTag = 'pt-PT'): string {
  return new Intl.DateTimeFormat(localeTag, { timeZone, dateStyle: 'medium', timeStyle: 'short' }).format(date);
}
