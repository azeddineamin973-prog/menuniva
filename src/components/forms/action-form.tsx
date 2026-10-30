'use client';

import { keepValuesOnSubmit } from '@/components/forms/use-keep-values';
import { createContext, useActionState, useContext, useEffect, useRef, useState } from 'react';
import { Alert, Button } from '@/components/ui';
import { initialActionState, type ActionResult } from '@/lib/action-result';
import { cn } from '@/lib/cn';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Action = (prev: any, form: FormData) => Promise<ActionResult<any>>;

const FieldErrorsContext = createContext<Record<string, string>>({});

const FRIENDLY: Record<string, string> = {
  invalid_phone: 'Enter a valid phone number, e.g. +351 935 413 677.',
  invalid_url: 'Enter a full link starting with https://',
  https_required: 'The link must start with https://',
  wrong_domain: 'This link does not belong to the expected website.',
  invalid_postal_pt: 'Use the Portuguese format 0000-000.',
  invalid_postal_es: 'Use the Spanish format 00000.',
  default_must_be_enabled: 'The default language must be one of the enabled languages.',
  source_must_be_enabled: 'The source language must be one of the enabled languages.',
};

export function friendlyError(code: string): string {
  if (FRIENDLY[code]) return FRIENDLY[code];
  if (/^Too (small|big)|^Invalid|^String must|^Expected/i.test(code)) return 'Please check this value.';
  return code;
}

export function useFieldError(name: string): string | undefined {
  const errors = useContext(FieldErrorsContext);
  const e = errors[name];
  return e ? friendlyError(e) : undefined;
}

export function FieldError({ name }: { name: string }) {
  const e = useFieldError(name);
  return e ? (
    <p className="mt-1 text-xs font-medium text-danger" role="alert">
      {e}
    </p>
  ) : null;
}

/**
 * Form bound to a server action. Shows saved/error state, exposes field errors to
 * <FieldError name="..."/>, and optionally resets after success.
 */
export function ActionForm({
  action,
  children,
  submitLabel = 'Save',
  className,
  resetOnSuccess = false,
  successText = 'Saved',
  hiddenSubmit = false,
  submitVariant = 'primary',
  testId,
  onSuccess,
}: {
  action: Action;
  children: React.ReactNode;
  submitLabel?: string;
  className?: string;
  resetOnSuccess?: boolean;
  successText?: string;
  hiddenSubmit?: boolean;
  submitVariant?: 'primary' | 'secondary' | 'dark' | 'danger';
  testId?: string;
  onSuccess?: (data: unknown) => void;
}) {
  const [state, formAction, pending] = useActionState<ActionResult<unknown>, FormData>(action, initialActionState);
  const [shown, setShown] = useState<ActionResult<unknown> | null>(null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state === initialActionState) return;
    setShown(state);
    if (state.ok) {
      if (resetOnSuccess) ref.current?.reset();
      onSuccess?.(state.data);
      const t = setTimeout(() => setShown(null), 4000);
      return () => clearTimeout(t);
    }
  }, [state, resetOnSuccess, onSuccess]);
  const fieldErrors = !state.ok && state.fieldErrors ? state.fieldErrors : {};
  return (
    <FieldErrorsContext.Provider value={fieldErrors}>
      <form ref={ref} onSubmit={keepValuesOnSubmit(formAction)} className={cn('space-y-4', className)} data-testid={testId}>
        {children}
        <div className={cn('flex flex-wrap items-center gap-3', hiddenSubmit && 'hidden')}>
          <Button type="submit" disabled={pending} variant={submitVariant}>
            {pending ? 'Saving…' : submitLabel}
          </Button>
          {shown?.ok && (
            <span className="text-sm font-medium text-success" role="status">
              ✓ {successText}
            </span>
          )}
        </div>
        {shown && !shown.ok && shown.error && (
          <Alert tone="danger">
            {shown.error === 'validation' ? 'Some fields need attention. Please check the highlighted fields.' : friendlyError(shown.error)}
          </Alert>
        )}
      </form>
    </FieldErrorsContext.Provider>
  );
}
