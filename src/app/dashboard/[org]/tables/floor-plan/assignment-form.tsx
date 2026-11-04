'use client';

import { useState } from 'react';
import { ActionForm } from '@/components/forms/action-form';
import { Badge, Checkbox, Icon } from '@/components/ui';
import { cn } from '@/lib/cn';
import { tableAssignmentAction } from '../../reservations/actions';

type Mode = 'staff' | 'automatic' | 'guest';
const OPTIONS: { key: Mode; title: string; text: string }[] = [
  { key: 'staff', title: 'You assign tables', text: 'Guests choose a date, time and party size. You pick a table for each request in Reservations.' },
  { key: 'automatic', title: 'Automatic assignment', text: 'Each request holds the smallest free table that seats the party. You still confirm it and can change the table.' },
  { key: 'guest', title: 'Guests choose on the floor plan', text: 'The booking page shows your plan with the tables free at the chosen time. Guests may also leave the choice to you.' },
];

/**
 * How tables get onto online reservation requests at this location. One compact row of choices
 * with the explanation of the selected one, so it never pushes the floor plan down the page.
 * Choosing an option only selects it: nothing changes for guests until this form is saved, so the
 * selection is marked until then (saving the floor plan itself never changes what guests see).
 */
export function TableAssignmentForm({ org, locationId, mode, autoFallback }: { org: string; locationId: string; mode: Mode; autoFallback: boolean }) {
  const [m, setM] = useState<Mode>(mode);
  const dirty = m !== mode;
  return (
    <ActionForm
      action={tableAssignmentAction}
      submitLabel="Save"
      submitVariant={dirty ? 'primary' : 'secondary'}
      successText="Saved"
      testId="table-assignment-form"
      className="space-y-2.5! md:grid md:grid-cols-[minmax(0,1fr)_auto] md:items-start md:gap-4"
    >
      <input type="hidden" name="org" value={org} />
      <input type="hidden" name="locationId" value={locationId} />
      <fieldset className="min-w-0 space-y-2">
        <legend className="sr-only">Table assignment for online requests</legend>
        <div className="flex flex-wrap gap-1.5">
          {OPTIONS.map((o) => (
            <label key={o.key} className={cn('flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 ring-1 transition-colors pointer-coarse:py-2', m === o.key ? 'bg-surface-2 ring-ink' : 'ring-line hover:ring-line-strong')}>
              <input type="radio" name="mode" value={o.key} checked={m === o.key} onChange={() => setM(o.key)} className="size-4 shrink-0 accent-[#6cb30a] pointer-coarse:size-5" data-testid={`assignment-${o.key}`} />
              <span className="text-[13px] font-medium text-ink">{o.title}</span>
              {o.key === mode && !dirty && (
                <Badge tone="success" dot>
                  Live
                </Badge>
              )}
            </label>
          ))}
        </div>
        <p className="text-xs leading-4 text-muted">{OPTIONS.find((o) => o.key === m)!.text}</p>
        {m === 'guest' && <Checkbox name="autoFallback" defaultChecked={mode !== 'guest' || autoFallback} label="When a guest leaves the choice to you, assign a free table automatically" data-testid="assignment-auto-fallback" />}
        {dirty && (
          <p className="flex items-center gap-1.5 text-xs font-medium text-warning" data-testid="assignment-unsaved">
            <Icon name="alert" className="size-3.5" /> Not saved yet — press Save to change what guests see.
          </p>
        )}
      </fieldset>
    </ActionForm>
  );
}
