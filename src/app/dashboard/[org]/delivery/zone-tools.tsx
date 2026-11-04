'use client';

import { useActionState, useRef, useState } from 'react';
import { Alert, Button, Field, Icon, Input } from '@/components/ui';
import { initialActionState, type ActionResult } from '@/lib/action-result';
import { formatCents } from '@/lib/money';
import type { ZoneTestResult } from '@/server/services/fulfilment';
import { testDeliveryAddressAction } from './actions';

/**
 * Where a zone delivers. One field, typed freely ("4700, 4705, Braga"), with one-tap suggestions
 * from the restaurant's own address so most owners never need to know a postal code.
 */
export function AreasInput({ id, defaultValue, suggestions }: { id: string; defaultValue?: string; suggestions: { label: string; value: string }[] }) {
  const ref = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(defaultValue ?? '');
  const parts = value.split(/[,;\n]/).map((p) => p.trim().toLowerCase()).filter(Boolean);
  const add = (v: string) => {
    const next = v === '*' ? '*' : [...value.split(/[,;\n]/).map((p) => p.trim()).filter((p) => p && p !== '*'), v].join(', ');
    setValue(next);
    ref.current?.focus();
  };
  return (
    <div className="space-y-2">
      <Input ref={ref} id={id} name="patterns" required value={value} onChange={(e) => setValue(e.target.value)} placeholder="e.g. 4700, Braga" autoComplete="off" />
      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1.5" aria-label="Suggestions">
          {suggestions.map((s) => {
            const used = parts.includes(s.value.toLowerCase());
            return (
              <button key={s.value} type="button" disabled={used} onClick={() => add(s.value)} className="inline-flex h-8 items-center gap-1 rounded-full border border-line bg-surface px-3 text-xs font-medium text-ink-2 transition-colors hover:border-line-strong hover:text-ink disabled:opacity-40 pointer-coarse:h-10" data-testid="area-suggestion">
                <Icon name="plus" className="size-3.5" />
                {s.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** "Would we deliver here, and for how much?": the exact rule guests get at checkout. */
export function AddressTester({ org, locationId, country, cityHint }: { org: string; locationId: string; country: 'PT' | 'ES'; cityHint?: string | null }) {
  const [state, action, pending] = useActionState<ActionResult<ZoneTestResult>, FormData>(testDeliveryAddressAction, initialActionState as ActionResult<ZoneTestResult>);
  const r = state.ok ? state.data : undefined;
  // Controlled, so the address stays in the fields after a check (forms reset after an action).
  const [postal, setPostal] = useState('');
  const [city, setCity] = useState('');
  return (
    <form action={action} className="space-y-3" data-testid="zone-tester">
      <input type="hidden" name="org" value={org} />
      <input type="hidden" name="locationId" value={locationId} />
      <div className="grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] gap-3">
        <Field label="Postal code" htmlFor="zt-postal">
          <Input id="zt-postal" name="postalCode" required inputMode="numeric" placeholder={country === 'PT' ? '4700-123' : '28013'} value={postal} onChange={(e) => setPostal(e.target.value)} />
        </Field>
        <Field label="Town" htmlFor="zt-city" optionalLabel="opt.">
          <Input id="zt-city" name="city" placeholder={cityHint ?? ''} value={city} onChange={(e) => setCity(e.target.value)} />
        </Field>
      </div>
      <Button type="submit" variant="secondary" disabled={pending}>
        <Icon name="search" className="size-4" />
        {pending ? 'Checking…' : 'Check'}
      </Button>
      {!state.ok && state.error && <Alert tone="danger">{state.error}</Alert>}
      {r && (
        <div role="status" data-testid="zone-test-result">
          {!r.valid ? (
            <Alert tone="danger">Not a valid {country === 'PT' ? 'Portuguese postal code (0000-000)' : 'Spanish postal code (00000)'}.</Alert>
          ) : r.zone ? (
            <Alert tone="success" title={`Delivered · ${r.zone.name}`}>
              Fee {r.zone.feeCents === 0 ? 'free' : formatCents(r.zone.feeCents)}
              {r.zone.minOrderCents > 0 && ` · minimum ${formatCents(r.zone.minOrderCents)}`}
              {r.zone.freeDeliveryThresholdCents !== null && ` · free from ${formatCents(r.zone.freeDeliveryThresholdCents)}`}
              {r.zone.estimatedMinutes && ` · ${r.zone.estimatedMinutes} min`}
            </Alert>
          ) : r.needsCity ? (
            <Alert tone="warning">No postal-code zone covers {r.postalCode}. Add the town to check your town zones.</Alert>
          ) : (
            <Alert tone="warning">Not delivered: no zone covers {r.postalCode}. Guests there are offered pickup instead.</Alert>
          )}
        </div>
      )}
    </form>
  );
}
