'use client';
import { Icon } from '@/components/ui/icons';

import { useState } from 'react';
import { DAY_KEYS, type OpeningHours } from '@/lib/opening-hours';

const DAY_LABEL: Record<string, string> = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };

const timeInput = 'h-9 w-[6.5rem] rounded-lg border border-line bg-surface px-2 text-sm pointer-coarse:h-11 pointer-coarse:text-base';
const smallButton = 'inline-flex min-h-8 items-center rounded-lg px-2 text-sm font-medium text-ink hover:bg-surface-2 pointer-coarse:min-h-10';

/**
 * Edits opening hours (up to two ranges per day). Empty = not configured; nothing is assumed.
 *
 * Also used for pickup, delivery and booking hours, where "empty" means "same as the opening
 * hours": those pass `inheritsFrom` so the editor says so instead of showing every day closed.
 */
export function OpeningHoursEditor({ name, initial, inheritsFrom }: { name: string; initial: OpeningHours | null; inheritsFrom?: string }) {
  const [hours, setHours] = useState<OpeningHours>(initial ?? {});
  // Any day touched counts as configured: a day left without ranges then means closed.
  const configured = Object.keys(hours).length > 0;
  const update = (day: (typeof DAY_KEYS)[number], ranges: { open: string; close: string }[]) => setHours((h) => ({ ...h, [day]: ranges }));
  const source = DAY_KEYS.find((d) => (hours[d] ?? []).length > 0);
  const copyToAll = () => setHours(Object.fromEntries(DAY_KEYS.map((d) => [d, (hours[source!] ?? []).map((r) => ({ ...r }))])) as OpeningHours);
  return (
    <div className="space-y-2" data-testid={`hours-${name}`}>
      <input type="hidden" name={name} value={configured ? JSON.stringify(hours) : ''} />
      {!configured && (
        <p className="text-xs text-muted" data-testid="hours-empty-note">
          {inheritsFrom ? `Using your ${inheritsFrom}. Add hours here only if they are different.` : 'Opening hours are not set yet. Add the hours your restaurant is open.'}
        </p>
      )}
      {DAY_KEYS.map((day) => {
        const ranges = hours[day] ?? [];
        return (
          // A day without hours stays on one line on a phone; with hours the time fields wrap.
          <div key={day} className={`flex items-center gap-x-2 gap-y-1.5 rounded-xl border border-line px-3 py-2 ${ranges.length ? 'flex-wrap' : ''}`}>
            <span className="w-20 shrink-0 text-sm font-medium sm:w-24">{DAY_LABEL[day]}</span>
            {ranges.length === 0 && <span className="min-w-0 flex-1 truncate text-sm text-muted">{!configured && inheritsFrom ? `As ${inheritsFrom}` : 'Closed'}</span>}
            {ranges.map((r, i) => (
              <span key={i} className="flex items-center gap-1">
                <input
                  type="time"
                  aria-label={`${DAY_LABEL[day]} opens`}
                  value={r.open}
                  onChange={(e) => update(day, ranges.map((x, j) => (j === i ? { ...x, open: e.target.value } : x)))}
                  className={timeInput}
                />
                <span className="text-muted">–</span>
                <input
                  type="time"
                  aria-label={`${DAY_LABEL[day]} closes`}
                  value={r.close}
                  onChange={(e) => update(day, ranges.map((x, j) => (j === i ? { ...x, close: e.target.value } : x)))}
                  className={timeInput}
                />
                <button
                  type="button"
                  className="flex size-8 items-center justify-center rounded-lg text-muted hover:bg-danger/10 hover:text-danger pointer-coarse:size-10"
                  aria-label={`Remove ${DAY_LABEL[day]} hours ${r.open}–${r.close}`}
                  onClick={() => update(day, ranges.filter((_, j) => j !== i))}
                >
                  <Icon name="x" className="size-4" />
                </button>
              </span>
            ))}
            {ranges.length < 2 && (
              <button type="button" className={`ms-auto shrink-0 ${smallButton}`} onClick={() => update(day, [...ranges, { open: '12:00', close: '15:00' }])}>
                <span className="sm:hidden">+ Add</span>
                <span className="hidden sm:inline">+ Add hours</span>
              </button>
            )}
          </div>
        );
      })}
      <div className="flex flex-wrap gap-2">
        {source && DAY_KEYS.some((d) => JSON.stringify(hours[d] ?? []) !== JSON.stringify(hours[source])) && (
          <button type="button" className={smallButton} onClick={copyToAll} data-testid="hours-copy-all">
            Use {DAY_LABEL[source]}’s hours for every day
          </button>
        )}
        {inheritsFrom && configured && (
          <button type="button" className={smallButton} onClick={() => setHours({})} data-testid="hours-reset">
            Use {inheritsFrom} again
          </button>
        )}
      </div>
    </div>
  );
}
