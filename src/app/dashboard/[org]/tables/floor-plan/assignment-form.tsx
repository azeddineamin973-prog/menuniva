'use client';

import { useState } from 'react';
import { ActionForm } from '@/components/forms/action-form';
import { Checkbox } from '@/components/ui';
import { cn } from '@/lib/cn';
import { tableAssignmentAction } from '../../reservations/actions';

type Mode = 'staff' | 'automatic' | 'guest';
const OPTIONS: { key: Mode; title: string; text: string }[] = [
  { key: 'staff', title: 'You assign tables', text: 'Guests choose a date, time and party size. You pick a table for each request in Reservations.' },
  { key: 'automatic', title: 'Automatic assignment', text: 'Each request holds the smallest free table that seats the party. You still confirm it and can change the table.' },
  { key: 'guest', title: 'Guests choose on the floor plan', text: 'The booking page shows your plan with the tables free at the chosen time. Guests may also leave the choice to you.' },
];

/** How tables get onto online reservation requests at this location. */
export function TableAssignmentForm({ org, locationId, mode, autoFallback }: { org: string; locationId: string; mode: Mode; autoFallback: boolean }) {
  const [m, setM] = useState<Mode>(mode);
  return (
    <ActionForm action={tableAssignmentAction} submitLabel="Save" submitVariant="secondary" successText="Saved" testId="table-assignment-form">
      <input type="hidden" name="org" value={org} />
      <input type="hidden" name="locationId" value={locationId} />
      <fieldset className="space-y-2">
        <legend className="sr-only">Table assignment for online requests</legend>
        <div className="grid gap-2 md:grid-cols-3">
          {OPTIONS.map((o) => (
            <label
              key={o.key}
              className={cn('flex cursor-pointer items-start gap-2.5 rounded-lg p-3 ring-1 transition-colors', m === o.key ? 'bg-surface-2 ring-ink' : 'ring-line hover:ring-line-strong')}
            >
              <input type="radio" name="mode" value={o.key} checked={m === o.key} onChange={() => setM(o.key)} className="mt-0.5 size-4 shrink-0 accent-[#6cb30a] pointer-coarse:size-5" data-testid={`assignment-${o.key}`} />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-ink">{o.title}</span>
                <span className="block text-xs text-muted">{o.text}</span>
              </span>
            </label>
          ))}
        </div>
        {m === 'guest' && (
          <Checkbox name="autoFallback" defaultChecked={mode !== 'guest' || autoFallback} label="When a guest leaves the choice to you, assign a free table automatically" data-testid="assignment-auto-fallback" />
        )}
      </fieldset>
    </ActionForm>
  );
}
