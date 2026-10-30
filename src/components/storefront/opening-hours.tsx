import { DAY_KEYS, isOpenAt, type OpeningHours } from '@/lib/opening-hours';
import { zonedParts } from '@/lib/time';

/** Opening hours as configured by the restaurant, with weekday names in the guest's language. */
export function StorefrontHours({ hours, timeZone, tag, m }: { hours: OpeningHours | null; timeZone: string; tag: string; m: { openingHours: string; openNow: string; closedNow: string; closedDay: string } }) {
  if (!hours || Object.keys(hours).length === 0) return null; // not configured: show nothing rather than guess
  const p = zonedParts(new Date(), timeZone);
  const open = isOpenAt(hours, p.weekday, p.hour * 60 + p.minute);
  // 2024-01-01 was a Monday; used only to get localized weekday names.
  const dayName = (i: number) => new Intl.DateTimeFormat(tag, { weekday: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 0, 1 + i)));
  const todayKey = DAY_KEYS[(p.weekday + 6) % 7];
  return (
    <details className="rounded-2xl bg-white/70 p-3 text-sm" data-testid="storefront-hours">
      <summary className="flex cursor-pointer items-center justify-between gap-2 font-medium">
        <span>{m.openingHours}</span>
        <span className={open ? 'text-emerald-800' : 'opacity-70'} data-testid="open-now">{open ? m.openNow : m.closedNow}</span>
      </summary>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        {DAY_KEYS.map((k, i) => (
          <div key={k} className={`contents ${k === todayKey ? 'font-semibold' : ''}`}>
            <dt className="capitalize">{dayName(i)}</dt>
            <dd className="tabular-nums" dir="ltr">{hours[k]?.length ? hours[k]!.map((r) => `${r.open}–${r.close}`).join(', ') : m.closedDay}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
