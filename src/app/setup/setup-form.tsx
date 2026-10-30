'use client';

import { useActionState } from 'react';
import { Alert, Button, Field, Input } from '@/components/ui';
import { initialActionState } from '@/lib/action-result';
import { bootstrapAdminAction } from './actions';

const messages: Record<string, string> = {
  setup_token_invalid: 'This setup link is no longer valid.',
  email_taken: 'An account with this email already exists. Use another email.',
  too_many_attempts: 'Too many attempts. Please wait and try again.',
};

export function SetupForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(bootstrapAdminAction, initialActionState);
  const fe = state.ok ? undefined : state.fieldErrors;
  return (
    <form action={action} className="space-y-4">
      {!state.ok && state.error && state.error !== 'validation' && <Alert tone="danger">{messages[state.error] ?? 'Something went wrong.'}</Alert>}
      <input type="hidden" name="token" value={token} />
      <Field label="Full name" htmlFor="name" error={fe?.name && 'Enter your name.'}>
        <Input id="name" name="name" required autoComplete="name" />
      </Field>
      <Field label="Email" htmlFor="email" error={fe?.email && 'Enter a valid email.'}>
        <Input id="email" name="email" type="email" required autoComplete="email" />
      </Field>
      <Field label="Password" htmlFor="password" hint="At least 10 characters. Use a password manager." error={fe?.password && 'At least 10 characters.'}>
        <Input id="password" name="password" type="password" minLength={10} required autoComplete="new-password" />
      </Field>
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? 'Creating…' : 'Create administrator'}
      </Button>
    </form>
  );
}
