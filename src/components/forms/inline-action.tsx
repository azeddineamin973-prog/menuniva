'use client';

import { useActionState, useEffect, useState } from 'react';
import { friendlyError } from '@/components/forms/action-form';
import { buttonClass } from '@/components/ui';
import { initialActionState, type ActionResult } from '@/lib/action-result';
import { cn } from '@/lib/cn';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Action = (prev: any, form: FormData) => Promise<ActionResult<any>>;

/** A single-button form (toggle, move, archive…) with hidden fields and inline error display. */
export function InlineAction({
  action,
  fields,
  label,
  variant = 'secondary',
  size = 'sm',
  className,
  confirm,
  title,
  testId,
}: {
  action: Action;
  fields: Record<string, string>;
  label: React.ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'dangerGhost' | 'dark';
  size?: 'sm' | 'md';
  className?: string;
  confirm?: string;
  title?: string;
  testId?: string;
}) {
  const [state, formAction, pending] = useActionState<ActionResult<unknown>, FormData>(action, initialActionState);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (state !== initialActionState && !state.ok && state.error) {
      setError(friendlyError(state.error));
      const t = setTimeout(() => setError(null), 6000);
      return () => clearTimeout(t);
    }
  }, [state]);
  return (
    <form
      action={formAction}
      className="relative inline-block"
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <button type="submit" disabled={pending} className={cn(buttonClass(variant, size), className)} title={title} data-testid={testId}>
        {label}
      </button>
      {error && (
        <span role="alert" className="absolute end-0 top-full z-10 mt-1 w-64 rounded-lg border border-danger/30 bg-surface px-2 py-1 text-xs text-danger shadow">
          {error}
        </span>
      )}
    </form>
  );
}
