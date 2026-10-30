'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { Alert, Button, Field, Input } from '@/components/ui';
import type { Messages } from '@/i18n';
import { initialActionState, type ActionResult } from '@/lib/action-result';
import { loginAction, requestPasswordResetAction, resetPasswordAction, signupAction } from './actions';

function errorText(m: Messages, code?: string): string | undefined {
  if (!code) return undefined;
  const map: Record<string, string> = {
    invalid_credentials: m.auth.invalidCredentials,
    password_too_short: m.auth.passwordTooShort,
    email_taken: m.auth.emailTaken,
    too_many_attempts: m.auth.tooManyAttempts,
    invalid_email: m.validation.invalidEmail,
    required: m.validation.required,
    link_invalid: m.auth.linkInvalid,
  };
  return map[code] ?? m.validation.required;
}

function FormError({ state, m }: { state: ActionResult; m: Messages }) {
  if (state.ok || !state.error || state.error === 'validation') return null;
  return <Alert tone="danger">{errorText(m, state.error)}</Alert>;
}

export function LoginForm({ m, next }: { m: Messages; next?: string }) {
  const [state, action, pending] = useActionState(loginAction, initialActionState);
  return (
    <form action={action} className="space-y-4" data-testid="login-form">
      <FormError state={state} m={m} />
      <input type="hidden" name="next" value={next ?? ''} />
      <Field label={m.auth.email} htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </Field>
      <Field label={m.auth.password} htmlFor="password">
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </Field>
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? m.common.loading : m.auth.signIn}
      </Button>
      <div className="flex justify-between text-sm">
        <Link href="/forgot-password" className="text-muted hover:text-ink">
          {m.auth.forgotPassword}
        </Link>
        <Link href={`/signup${next ? `?next=${encodeURIComponent(next)}` : ''}`} className="font-medium text-ink underline-offset-4 hover:underline">
          {m.auth.signUp}
        </Link>
      </div>
    </form>
  );
}

export function SignupForm({ m, next }: { m: Messages; next?: string }) {
  const [state, action, pending] = useActionState(signupAction, initialActionState);
  const fe = state.ok ? undefined : state.fieldErrors;
  return (
    <form action={action} className="space-y-4" data-testid="signup-form">
      <FormError state={state} m={m} />
      <input type="hidden" name="next" value={next ?? ''} />
      <Field label={m.auth.name} htmlFor="name" error={errorText(m, fe?.name)}>
        <Input id="name" name="name" autoComplete="name" required />
      </Field>
      <Field label={m.auth.email} htmlFor="email" error={errorText(m, fe?.email)}>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </Field>
      <Field label={m.auth.password} htmlFor="password" hint={m.auth.passwordTooShort} error={errorText(m, fe?.password)}>
        <Input id="password" name="password" type="password" autoComplete="new-password" minLength={10} required />
      </Field>
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? m.common.loading : m.auth.signUp}
      </Button>
      <p className="text-center text-sm text-muted">
        {m.auth.haveAccount}{' '}
        <Link href="/login" className="font-medium text-ink underline-offset-4 hover:underline">
          {m.auth.signIn}
        </Link>
      </p>
    </form>
  );
}

export function ForgotPasswordForm({ m }: { m: Messages }) {
  const [state, action, pending] = useActionState(requestPasswordResetAction, initialActionState);
  if (state.ok) return <Alert tone="success">{m.auth.resetSent}</Alert>;
  return (
    <form action={action} className="space-y-4">
      <FormError state={state} m={m} />
      <Field label={m.auth.email} htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </Field>
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {m.common.continue}
      </Button>
    </form>
  );
}

export function ResetPasswordForm({ m, token }: { m: Messages; token: string }) {
  const [state, action, pending] = useActionState(resetPasswordAction, initialActionState);
  if (state.ok)
    return (
      <div className="space-y-4">
        <Alert tone="success">{m.auth.resetDone}</Alert>
        <Link href="/login" className="block text-center text-sm font-medium underline">
          {m.auth.signIn}
        </Link>
      </div>
    );
  const fe = state.fieldErrors;
  return (
    <form action={action} className="space-y-4">
      <FormError state={state} m={m} />
      <input type="hidden" name="token" value={token} />
      <Field label={m.auth.newPassword} htmlFor="password" hint={m.auth.passwordTooShort} error={errorText(m, fe?.password)}>
        <Input id="password" name="password" type="password" autoComplete="new-password" minLength={10} required />
      </Field>
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {m.common.save}
      </Button>
    </form>
  );
}
