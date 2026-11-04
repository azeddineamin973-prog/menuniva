import { cn } from '@/lib/cn';
import { DAY_KEYS, isOpenAt, type OpeningHours } from '@/lib/opening-hours';
import { zonedParts } from '@/lib/time';

/**
 * Opening hours as configured by the restaurant, with weekday names in the guest's language.
 * Closed: open/closed now and today's hours. Opened: the whole week, today in bold.
 * `tone="dark"` for the dark storefront footer.
 */
export function StorefrontHours({ hours, timeZone, tag, m, tone = 'light', todayLabel }: { hours: OpeningHours | null; timeZone: string; tag: string; m: { openingHours: string; openNow: string; closedNow: string; closedDay: string }; tone?: 'light' | 'dark'; todayLabel?: string }) {
  if (!hours || Object.keys(hours).length === 0) return null; // not configured: show nothing rather than guess
  const p = zonedParts(new Date(), timeZone);
  const open = isOpenAt(hours, p.weekday, p.hour * 60 + p.minute);
  // 2024-01-01 was a Monday; used only to get localized weekday names.
  const dayName = (i: number) => new Intl.DateTimeFormat(tag, { weekday: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 0, 1 + i)));
  const todayKey = DAY_KEYS[(p.weekday + 6) % 7];
  const ranges = (k: (typeof DAY_KEYS)[number]) => (hours[k]?.length ? hours[k]!.map((r) => `${r.open}–${r.close}`).join(', ') : m.closedDay);
  const dark = tone === 'dark';
  return (
    <details className="group text-[15px]" data-testid="storefront-hours">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 font-medium [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 items-center gap-3">
          <svg viewBox="0 0 24 24" className={cn('size-5 shrink-0', dark ? 'opacity-70' : 'text-sf-primary-ink')} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" />
          </svg>
          {todayLabel ? (
            // Under a column heading: today's hours first, open / closed under them.
            <span className="min-w-0">
              <span className="block tabular-nums" dir="auto">
                {todayLabel} · <span dir="ltr">{ranges(todayKey)}</span>
              </span>
              <span className={cn('block text-[13px] font-normal', open ? (dark ? 'text-emerald-300' : 'text-emerald-800') : 'opacity-70')} data-testid="open-now">
                {open ? m.openNow : m.closedNow}
              </span>
            </span>
          ) : (
            <span>{m.openingHours}</span>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {!todayLabel && (
            <span className={cn('text-sm', open ? (dark ? 'text-emerald-300' : 'text-emerald-800') : 'opacity-70')} data-testid="open-now">
              {open ? m.openNow : m.closedNow}
            </span>
          )}
          <svg viewBox="0 0 24 24" className="size-4 opacity-60 transition-transform group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <path d="m6 9 6 6 6-6" />
          </svg>
        </span>
      </summary>
      <dl className={cn('mt-1 mb-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 ps-8 text-sm', dark && 'opacity-85')}>
        {DAY_KEYS.map((k, i) => (
          <div key={k} className={`contents ${k === todayKey ? 'font-semibold' : ''}`}>
            <dt className="capitalize">{dayName(i)}</dt>
            <dd className="tabular-nums" dir="ltr">
              {ranges(k)}
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
