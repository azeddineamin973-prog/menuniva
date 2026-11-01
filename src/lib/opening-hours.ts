// No validation library here: the browser's opening-hours editor imports this file, and zod
// would add about 30 KB to every page with the editor. The schema is in opening-hours-schema.ts.
export const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type DayKey = (typeof DAY_KEYS)[number];
export type OpeningHours = Partial<Record<DayKey, { open: string; close: string }[]>>;

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
