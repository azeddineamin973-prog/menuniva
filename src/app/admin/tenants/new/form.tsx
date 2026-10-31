'use client';

import { keepValuesOnSubmit } from '@/components/forms/use-keep-values';
import Link from 'next/link';
import { useActionState } from 'react';
import { friendlyError } from '@/components/forms/action-form';
import { Alert, Button, Field, Input, Select, Icon } from '@/components/ui';
import { initialActionState, type ActionResult } from '@/lib/action-result';
import { createTenantAction } from '../../actions';

type Created = { slug: string; id: string; inviteLink: string | null; ownerExisted: boolean };

export function CreateTenantForm() {
  const [state, action, pending] = useActionState<ActionResult<Created>, FormData>(createTenantAction, initialActionState as ActionResult<Created>);
  if (state.ok && state.data) {
    const d = state.data;
    return (
      <div className="space-y-4" data-testid="tenant-created">
        <Alert tone="success" title="Tenant created">/{d.slug}</Alert>
        {d.inviteLink ? (
          <div>
            <p className="mb-1 text-sm font-medium">Owner invitation link (valid 7 days) — send it to the owner personally:</p>
            <code className="block rounded-xl bg-surface-2 p-3 text-xs break-all" data-testid="invite-link">{d.inviteLink}</code>
          </div>
        ) : (
          <p className="text-sm text-muted">The owner already had an account and has been added as owner.</p>
        )}
        <Link href={`/admin/tenants/${d.id}`} className="inline-flex items-center gap-1 text-sm font-medium underline underline-offset-2">Open tenant <Icon name="arrowRight" className="size-3.5" /></Link>
      </div>
    );
  }
  const fe = !state.ok ? state.fieldErrors : undefined;
  return (
    <form onSubmit={keepValuesOnSubmit(action)} className="space-y-4" data-testid="create-tenant-form">
      {!state.ok && state.error && state.error !== 'validation' && <Alert tone="danger">{friendlyError(state.error)}</Alert>}
      <Field label="Restaurant name" htmlFor="name" error={fe?.name && 'Required (2–100 characters).'}>
        <Input id="name" name="name" required />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Country" htmlFor="country">
          <Select id="country" name="country" defaultValue="PT">
            <option value="PT">Portugal</option>
            <option value="ES">España</option>
          </Select>
        </Field>
        <Field label="City" htmlFor="city" optionalLabel="optional">
          <Input id="city" name="city" />
        </Field>
      </div>
      <Field label="Owner email" htmlFor="ownerEmail" error={fe?.ownerEmail && 'Enter a valid email.'}>
        <Input id="ownerEmail" name="ownerEmail" type="email" required />
      </Field>
      <Button type="submit" disabled={pending}>{pending ? 'Creating…' : 'Create tenant'}</Button>
    </form>
  );
}
