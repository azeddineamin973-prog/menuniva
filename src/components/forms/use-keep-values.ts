'use client';

import { startTransition, type FormEvent } from 'react';

/**
 * React 19 resets uncontrolled form fields after every form action, even when the server
 * rejects the input — users would lose what they typed. Submitting through onSubmit (and
 * calling the action ourselves) keeps the values; forms reset only when we decide to.
 */
export function keepValuesOnSubmit(formAction: (data: FormData) => void) {
  return (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter ?? undefined);
    startTransition(() => formAction(data));
  };
}
