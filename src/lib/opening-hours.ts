import { z } from 'zod';

export const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type DayKey = (typeof DAY_KEYS)[number];

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const range = z.object({ open: hhmm, close: hhmm });
export const openingHoursSchema = z.partialRecord(z.enum(DAY_KEYS), z.array(range).max(3));
export type OpeningHours = z.infer<typeof openingHoursSchema>;

/** JS getDay() (0 = Sunday) → key */
export function dayKeyFromIndex(i: number): DayKey {
  return (['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const)[i];
}

export function toMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

/** Ranges for a weekday in minutes; a close ≤ open means "closes after midnight". */
export function rangesFor(hours: OpeningHours | null | undefined, weekday: number): Array<[number, number]> {
  const list = hours?.[dayKeyFromIndex(weekday)] ?? [];
  return list.map((r) => {
    const o = toMinutes(r.open);
    let c = toMinutes(r.close);
    if (c <= o) c += 24 * 60;
    return [o, c];
  });
}

export function isOpenAt(hours: OpeningHours | null | undefined, weekday: number, minuteOfDay: number): boolean {
  if (rangesFor(hours, weekday).some(([o, c]) => minuteOfDay >= o && minuteOfDay < c)) return true;
  // Previous day's range spilling past midnight
  const prev = (weekday + 6) % 7;
  return rangesFor(hours, prev).some(([, c]) => c > 1440 && minuteOfDay + 1440 < c);
}
