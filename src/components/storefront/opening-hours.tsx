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
    <details className="group rounded-2xl bg-sf-card/70 px-3 py-1 text-sm" data-testid="storefront-hours">
      <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-2 font-medium [&::-webkit-details-marker]:hidden">
        <span>{m.openingHours}</span>
        <span className="flex items-center gap-2">
          <span className={open ? 'text-emerald-800' : 'opacity-70'} data-testid="open-now">
            {open ? m.openNow : m.closedNow}
          </span>
          <svg viewBox="0 0 24 24" className="size-4 opacity-60 transition-transform group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <path d="m6 9 6 6 6-6" />
          </svg>
        </span>
      </summary>
      <dl className="mt-1 mb-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
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
