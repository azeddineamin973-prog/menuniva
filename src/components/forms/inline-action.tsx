'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { friendlyError } from '@/components/forms/action-form';
import { Button, buttonClass } from '@/components/ui';
import { Dialog } from '@/components/ui/dialog';
import { initialActionState, type ActionResult } from '@/lib/action-result';
import { cn } from '@/lib/cn';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Action = (prev: any, form: FormData) => Promise<ActionResult<any>>;

/**
 * A single-button form (toggle, move, archive…) with hidden fields and inline error display.
 * With `confirm`, destructive actions ask first in an in-app dialog (keyboard and screen-reader
 * friendly, styled like the rest of the dashboard) instead of the browser's native prompt.
 */
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
  const [asking, setAsking] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const confirmed = useRef(false);
  useEffect(() => {
    if (state !== initialActionState && !state.ok && state.error) {
      setError(friendlyError(state.error));
      const t = setTimeout(() => setError(null), 6000);
      return () => clearTimeout(t);
    }
  }, [state]);
  return (
    <form
      ref={formRef}
      action={formAction}
      className="relative inline-block"
      onSubmit={(e) => {
        if (confirm && !confirmed.current) {
          e.preventDefault();
          setAsking(true);
          return;
        }
        confirmed.current = false;
      }}
    >
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <button type="submit" disabled={pending} className={cn(buttonClass(variant, size), className)} title={title} data-testid={testId}>
        {label}
      </button>
      {confirm && (
        <Dialog
          open={asking}
          onClose={() => setAsking(false)}
          title={confirm}
          testId="confirm-dialog"
          footer={
            <>
              <Button type="button" variant="secondary" onClick={() => setAsking(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                variant={variant === 'primary' ? 'primary' : 'danger'}
                onClick={() => {
                  setAsking(false);
                  confirmed.current = true;
                  formRef.current?.requestSubmit();
                }}
                data-testid="confirm-action"
              >
                {typeof label === 'string' ? label : 'Confirm'}
              </Button>
            </>
          }
        />
      )}
      {error && (
        <span role="alert" className="absolute end-0 top-full z-10 mt-1 w-64 rounded-lg border border-danger/30 bg-surface px-2 py-1 text-xs text-danger shadow">
          {error}
        </span>
      )}
    </form>
  );
}
