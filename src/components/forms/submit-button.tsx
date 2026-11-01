'use client';

import type { ComponentProps } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui';

/**
 * Submit button for a form posting to a server action from a server component: while the
 * request is on its way it shows a spinner and `pendingLabel` and cannot be pressed again, so a
 * slow connection never invites a second tap.
 */
export function SubmitButton({ pendingLabel, children, ...props }: Omit<ComponentProps<typeof Button>, 'type' | 'loading'> & { pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending} {...props}>
      {pending ? pendingLabel : children}
    </Button>
  );
}
