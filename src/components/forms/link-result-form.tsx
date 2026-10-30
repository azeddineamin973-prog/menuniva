'use client';

import { keepValuesOnSubmit } from '@/components/forms/use-keep-values';
import { useActionState } from 'react';
import { friendlyError } from '@/components/forms/action-form';
import { Alert, Button } from '@/components/ui';
import { initialActionState, type ActionResult } from '@/lib/action-result';

type R = ActionResult<{ link: string }>;

/** Form whose action returns a one-time link (invitation / password reset) to share personally. */
export function LinkResultForm({
  action,
  children,
  submitLabel,
  note,
  testId,
}: {
  action: (p: R, f: FormData) => Promise<R>;
  children: React.ReactNode;
  submitLabel: string;
  note?: string;
  testId?: string;
}) {
  const [state, formAction, pending] = useActionState<R, FormData>(action, initialActionState as R);
  return (
    <form onSubmit={keepValuesOnSubmit(formAction)} className="space-y-3" data-testid={testId}>
      {children}
      <Button type="submit" disabled={pending} variant="dark">
        {pending ? 'Working…' : submitLabel}
      </Button>
      {state.ok && state.data && (
        <div>
          {note && <p className="mb-1 text-xs text-muted">{note}</p>}
          <code className="block rounded-xl bg-surface-2 p-3 text-xs break-all" data-testid="generated-link">
            {state.data.link}
          </code>
        </div>
      )}
      {!state.ok && state.error && <Alert tone="danger">{state.error === 'validation' ? 'Please check the form.' : friendlyError(state.error)}</Alert>}
    </form>
  );
}
