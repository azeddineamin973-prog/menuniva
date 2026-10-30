'use client';

import { keepValuesOnSubmit } from '@/components/forms/use-keep-values';
import { useActionState, useState } from 'react';
import { Alert, Button, Field, Input, Select } from '@/components/ui';
import { initialActionState } from '@/lib/action-result';
import { registerRestaurantAction } from './actions';

export function RegisterRestaurantForm() {
  const [state, action, pending] = useActionState(registerRestaurantAction, initialActionState);
  const [country, setCountry] = useState<'PT' | 'ES'>('PT');
  const fe = state.ok ? undefined : state.fieldErrors;
  return (
    <form onSubmit={keepValuesOnSubmit(action)} className="space-y-4" data-testid="register-restaurant-form">
      {!state.ok && state.error && state.error !== 'validation' && <Alert tone="danger">{state.error}</Alert>}
      <Field label="Restaurant name" htmlFor="name" error={fe?.name && 'Enter the restaurant name (2–100 characters).'}>
        <Input id="name" name="name" required minLength={2} maxLength={100} placeholder="e.g. Casa de Marrocos" />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Country" htmlFor="country">
          <Select id="country" name="country" value={country} onChange={(e) => setCountry(e.target.value as 'PT' | 'ES')}>
            <option value="PT">Portugal</option>
            <option value="ES">España</option>
          </Select>
        </Field>
        <Field label="Default menu language" htmlFor="defaultLanguage">
          <Select id="defaultLanguage" name="defaultLanguage" key={country} defaultValue={country === 'PT' ? 'pt' : 'es'}>
            <option value="pt">Português (pt-PT)</option>
            <option value="es">Español</option>
            <option value="en">English</option>
            <option value="fr">Français</option>
            <option value="ar">العربية</option>
          </Select>
        </Field>
      </div>
      <Field label="City" htmlFor="city" optionalLabel="optional">
        <Input id="city" name="city" maxLength={80} placeholder={country === 'PT' ? 'e.g. Braga' : 'e.g. Madrid'} />
      </Field>
      <p className="text-xs text-muted">
        Time zone is set to {country === 'PT' ? 'Europe/Lisbon' : 'Europe/Madrid'} and prices are in EUR. A free manual trial
        starts automatically; no payment details are requested.
      </p>
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? 'Creating…' : 'Create restaurant'}
      </Button>
    </form>
  );
}
