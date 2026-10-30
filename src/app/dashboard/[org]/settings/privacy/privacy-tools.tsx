'use client';

import { useActionState, useState } from 'react';
import { friendlyError } from '@/components/forms/action-form';
import { Alert, Button, Field, Input } from '@/components/ui';
import { initialActionState, type ActionResult } from '@/lib/action-result';

type Counts = { orders: number; reservations: number; feedback: number; loyalty: number };
type A = (p: ActionResult<Counts>, f: FormData) => Promise<ActionResult<Counts>>;

const summary = (c: Counts) => `${c.orders} orders · ${c.reservations} reservations · ${c.feedback} feedback contacts · ${c.loyalty} loyalty members`;

/** Guest data request: search by phone or email, export as JSON, or erase after typing ERASE. */
export function PrivacyTools({ org, find, erase }: { org: string; find: A; erase: A }) {
  const [q, setQ] = useState('');
  const [found, findAction, finding] = useActionState<ActionResult<Counts>, FormData>(find, initialActionState as ActionResult<Counts>);
  const [erased, eraseAction, erasing] = useActionState<ActionResult<Counts>, FormData>(erase, initialActionState as ActionResult<Counts>);
  const err = (s: ActionResult<Counts>) => (!s.ok && s.error ? <Alert tone="danger">{friendlyError(s.error)}</Alert> : null);
  return (
    <div className="space-y-4">
      <form action={findAction} className="flex flex-wrap items-end gap-2" data-testid="privacy-search">
        <input type="hidden" name="org" value={org} />
        <div className="min-w-60 flex-1">
          <Field label="Guest phone number or email" htmlFor="pv-q">
            <Input id="pv-q" name="q" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" required />
          </Field>
        </div>
        <Button type="submit" variant="dark" disabled={finding}>{finding ? 'Searching…' : 'Find data'}</Button>
      </form>
      {err(found)}
      {found.ok && found.data && (
        <div className="space-y-3 rounded-2xl border border-line p-4">
          <p className="text-sm" data-testid="privacy-found">Found: {summary(found.data)}</p>
          <form method="post" action={`/api/dashboard/${org}/privacy/export`}>
            <input type="hidden" name="q" value={q} />
            <Button type="submit" variant="secondary" data-testid="privacy-export">Download data (JSON)</Button>
          </form>
          <form action={eraseAction} className="flex flex-wrap items-end gap-2" data-testid="privacy-erase">
            <input type="hidden" name="org" value={org} />
            <input type="hidden" name="q" value={q} />
            <Field label="Type ERASE to remove this guest's personal data" htmlFor="pv-confirm">
              <Input id="pv-confirm" name="confirm" autoComplete="off" className="w-40" />
            </Field>
            <Button type="submit" variant="danger" disabled={erasing}>{erasing ? 'Erasing…' : 'Erase personal data'}</Button>
          </form>
          {err(erased)}
          {erased.ok && erased.data && <Alert tone="success">Erased: {summary(erased.data)}. Order amounts and dishes are kept for your accounting.</Alert>}
        </div>
      )}
    </div>
  );
}
