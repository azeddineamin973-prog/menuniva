'use client';

import { useActionState, useRef, useState } from 'react';
import { friendlyError } from '@/components/forms/action-form';
import { Badge, Button } from '@/components/ui';
import { Icon } from '@/components/ui/icons';
import { initialActionState, type ActionResult } from '@/lib/action-result';
import { cn } from '@/lib/cn';
import { regeneratePinAction, revealPinAction } from '../bills/actions';
import { useUiText } from '@/components/ui-text';
import { fmt } from '@/i18n/config';
import type { DashText } from '@/i18n/dash/en';

type PinResult = ActionResult<{ pin: string; locked?: boolean; failures?: number }>;
type PinAction = (prev: PinResult, form: FormData) => Promise<PinResult>;

/**
 * The table PIN for staff. The PIN is never in the page's HTML: "Show PIN" asks the server (the
 * request is permission-checked and audited) and the PIN is shown here for 60 seconds, large enough
 * to read out at the table. "New PIN" issues another one (and clears a lock); phones that already
 * entered the old PIN keep ordering.
 */
export function TablePinPanel({ org, sessionId, locked, failures, phones, compact = false, testId = 'table-pin', t }: { org: string; sessionId: string; locked: boolean; failures: number; phones: number; compact?: boolean; testId?: string; t: DashText['pin'] }) {
  const ui = useUiText();
  const [visible, setVisible] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // The PIN is kept only in this component's memory, and only for a minute.
  const withPin = (action: PinAction): PinAction => async (prev, form) => {
    const r = await action(prev, form);
    clearTimeout(hideTimer.current);
    if (r.ok && r.data?.pin) {
      setError(null);
      setVisible(r.data.pin);
      hideTimer.current = setTimeout(() => setVisible(null), 60_000);
    } else if (!r.ok) {
      setError(friendlyError(r.error, null, ui));
    }
    return r;
  };
  const [, showAction, showing] = useActionState<PinResult, FormData>(withPin(revealPinAction as unknown as PinAction), initialActionState as PinResult);
  const [, issueAction, issuing] = useActionState<PinResult, FormData>(withPin(regeneratePinAction as unknown as PinAction), initialActionState as PinResult);

  return (
    <div className={cn('rounded-xl border p-2.5', locked ? 'border-danger/40 bg-danger/5' : 'border-line bg-surface-2/60')} data-testid={testId}>
      <div className="flex flex-wrap items-center gap-2">
        <Icon name="shield" className="size-4 shrink-0 text-ink-2" />
        <span className="text-xs font-medium text-ink-2">{t.title}</span>
        {visible ? (
          <span className="font-mono text-xl font-semibold tracking-[0.25em] text-ink tabular-nums" data-testid={`${testId}-value`} aria-live="polite">
            {visible}
          </span>
        ) : (
          <span className="font-mono text-base tracking-[0.3em] text-muted" aria-label={t.hidden}>••••••</span>
        )}
        <span className="ms-auto flex gap-1">
          <form action={showAction}>
            <input type="hidden" name="org" value={org} />
            <input type="hidden" name="sessionId" value={sessionId} />
            <Button type="submit" size="sm" variant="secondary" disabled={showing || locked} data-testid={`${testId}-show`}>
              {visible ? t.shown : t.show}
            </Button>
          </form>
          <form action={issueAction}>
            <input type="hidden" name="org" value={org} />
            <input type="hidden" name="sessionId" value={sessionId} />
            <Button type="submit" size="sm" variant={locked ? 'primary' : 'ghost'} disabled={issuing} data-testid={`${testId}-new`}>
              {t.newPin}
            </Button>
          </form>
        </span>
      </div>
      {!compact && (
        <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
          <span data-testid={`${testId}-phones`}>{phones === 1 ? t.phones1 : fmt(t.phonesN, { n: phones })}</span>
          {failures > 0 && !locked && <span>{failures === 1 ? t.wrong1 : fmt(t.wrongN, { n: failures })}</span>}
          {locked && <Badge tone="danger">{t.locked}</Badge>}
        </p>
      )}
      <p className="mt-1 text-[11px] text-muted">{t.tell}</p>
      {error && <p role="alert" className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}
