export type ScheduleRange = { days: number[]; start: string; end: string };

/** DB rows (one per day) → grouped ranges for the editor. */
export function groupSchedules(rows: { dayOfWeek: number; startMinute: number; endMinute: number }[]): ScheduleRange[] {
  const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const map = new Map<string, number[]>();
  for (const r of rows) {
    const k = `${r.startMinute}-${r.endMinute}`;
    map.set(k, [...(map.get(k) ?? []), r.dayOfWeek]);
  }
  return [...map.entries()].map(([k, days]) => {
    const [s, e] = k.split('-').map(Number);
    return { days: days.sort(), start: fmt(s), end: fmt(e) };
  });
}
