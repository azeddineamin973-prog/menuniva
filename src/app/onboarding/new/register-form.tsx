'use client';

import { keepValuesOnSubmit } from '@/components/forms/use-keep-values';
import { useActionState, useState } from 'react';
import { useUiText } from '@/components/ui-text';
import { Alert, Button, Field, Input, Select } from '@/components/ui';
import type { DashText } from '@/i18n/dash/en';
import { fmt } from '@/i18n/config';
import { initialActionState } from '@/lib/action-result';
import { registerRestaurantAction } from './actions';

export function RegisterRestaurantForm({ t }: { t: DashText['onboarding'] }) {
  const [state, action, pending] = useActionState(registerRestaurantAction, initialActionState);
  const ui = useUiText();
  const [country, setCountry] = useState<'PT' | 'ES'>('PT');
  const fe = state.ok ? undefined : state.fieldErrors;
  // The action answers with codes; the text is shown in the page language.
  const errorText = (code: string) => (code === 'signups_paused' ? t.paused : code === 'too_many' ? t.tooMany : code);
  return (
    <form onSubmit={keepValuesOnSubmit(action)} className="space-y-4" data-testid="register-restaurant-form">
      {!state.ok && state.error && state.error !== 'validation' && <Alert tone="danger">{errorText(state.error)}</Alert>}
      <Field label={t.name} htmlFor="name" error={fe?.name && t.nameError}>
        <Input id="name" name="name" required minLength={2} maxLength={100} placeholder={t.namePlaceholder} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t.country} htmlFor="country">
          <Select id="country" name="country" value={country} onChange={(e) => setCountry(e.target.value as 'PT' | 'ES')}>
            <option value="PT">Portugal</option>
            <option value="ES">España</option>
          </Select>
        </Field>
        <Field label={t.menuLanguage} htmlFor="defaultLanguage">
          <Select id="defaultLanguage" name="defaultLanguage" key={country} defaultValue={country === 'PT' ? 'pt' : 'es'}>
            <option value="pt">Português (pt-PT)</option>
            <option value="es">Español</option>
            <option value="en">English</option>
            <option value="fr">Français</option>
            <option value="ar">العربية</option>
          </Select>
        </Field>
      </div>
      <p className="-mt-2 text-xs text-muted" data-testid="menu-language-hint">{t.menuLanguageHint}</p>
      <Field label={t.city} htmlFor="city" optionalLabel={ui.optional}>
        <Input id="city" name="city" maxLength={80} placeholder={country === 'PT' ? t.cityPt : t.cityEs} />
      </Field>
      <p className="text-xs text-muted">{fmt(t.trial, { tz: country === 'PT' ? 'Europe/Lisbon' : 'Europe/Madrid' })}</p>
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? t.creating : t.create}
      </Button>
    </form>
  );
}
