'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui';

/** One-click copy with a visible confirmation. Falls back to a hidden textarea where the async clipboard API is unavailable. */
export function CopyLinkButton({ value, label = 'Copy link', className, testId }: { value: string; label?: string; className?: string; testId?: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  useEffect(() => {
    if (state === 'idle') return;
    const t = setTimeout(() => setState('idle'), 2500);
    return () => clearTimeout(t);
  }, [state]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setState('copied');
    } catch {
      const ta = document.createElement('textarea');
      ta.value = value;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      setState(ok ? 'copied' : 'failed');
    }
  };
  return (
    <>
      <Button type="button" variant="secondary" icon={state === 'copied' ? 'check' : 'copy'} onClick={copy} className={className} data-testid={testId} data-state={state}>
        {state === 'copied' ? 'Copied' : label}
      </Button>
      <span className="sr-only" role="status" aria-live="polite">
        {state === 'copied' ? 'Link copied to the clipboard' : state === 'failed' ? 'Could not copy. Select the address and copy it manually.' : ''}
      </span>
    </>
  );
}
