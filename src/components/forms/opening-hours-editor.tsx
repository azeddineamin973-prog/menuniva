'use client';

import { useState } from 'react';
import { DAY_KEYS, type OpeningHours } from '@/lib/opening-hours';

const DAY_LABEL: Record<string, string> = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };

/** Edits opening hours (up to two ranges per day). Empty = not configured; nothing is assumed. */
export function OpeningHoursEditor({ name, initial }: { name: string; initial: OpeningHours | null }) {
  const [hours, setHours] = useState<OpeningHours>(initial ?? {});
  const configured = Object.keys(hours).length > 0;
  const update = (day: (typeof DAY_KEYS)[number], ranges: { open: string; close: string }[]) => setHours((h) => ({ ...h, [day]: ranges }));
  return (
    <div className="space-y-2">
      <input type="hidden" name={name} value={configured ? JSON.stringify(hours) : ''} />
      {!configured && <p className="text-xs text-muted">Opening hours are not set yet. Add the hours your restaurant is open.</p>}
      {DAY_KEYS.map((day) => {
        const ranges = hours[day] ?? [];
        return (
          <div key={day} className="flex flex-wrap items-center gap-2 rounded-xl border border-line px-3 py-2">
            <span className="w-24 text-sm font-medium">{DAY_LABEL[day]}</span>
            {ranges.length === 0 && <span className="text-sm text-muted">Closed</span>}
            {ranges.map((r, i) => (
              <span key={i} className="flex items-center gap-1">
                <input
                  type="time"
                  aria-label={`${DAY_LABEL[day]} opens`}
                  value={r.open}
                  onChange={(e) => update(day, ranges.map((x, j) => (j === i ? { ...x, open: e.target.value } : x)))}
                  className="h-8 rounded-lg border border-line bg-surface px-2 text-sm"
                />
                <span className="text-muted">–</span>
                <input
                  type="time"
                  aria-label={`${DAY_LABEL[day]} closes`}
                  value={r.close}
                  onChange={(e) => update(day, ranges.map((x, j) => (j === i ? { ...x, close: e.target.value } : x)))}
                  className="h-8 rounded-lg border border-line bg-surface px-2 text-sm"
                />
                <button type="button" className="px-1 text-sm text-muted hover:text-danger" aria-label="Remove range" onClick={() => update(day, ranges.filter((_, j) => j !== i))}>
                  ✕
                </button>
              </span>
            ))}
            {ranges.length < 2 && (
              <button type="button" className="ms-auto text-xs font-medium text-ink underline-offset-2 hover:underline" onClick={() => update(day, [...ranges, { open: '12:00', close: '15:00' }])}>
                + Add hours
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
