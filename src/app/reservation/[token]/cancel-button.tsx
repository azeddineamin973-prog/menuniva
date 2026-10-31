'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

/**
 * Lets the guest cancel their own booking from the private link. The restaurant is notified and
 * the table is freed, which is the whole point: a no-show nobody cancelled costs a sitting.
 *
 * `cancellable` comes from the server, and the server checks the same rule again when the
 * request arrives — a page left open all afternoon cannot cancel a table that is already being
 * held. The confirmation message is rendered by this component rather than by the page, so it
 * survives the refresh that follows a successful cancellation.
 */
export function CancelReservationButton({
  token,
  cancellable,
  labels,
}: {
  token: string;
  cancellable: boolean;
  labels: { cancel: string; confirm: string; done: string; tooLate: string; retry: string };
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const cancel = async () => {
    if (!window.confirm(labels.confirm)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/public/reservations/${encodeURIComponent(token)}`, { method: 'DELETE' });
      if (res.ok) {
        setMessage(labels.done);
        router.refresh();
      } else {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setMessage(body.error === 'too_late' ? labels.tooLate : labels.retry);
      }
    } catch {
      setMessage(labels.retry);
    }
    setBusy(false);
  };

  if (message) {
    return (
      <p className="rounded-2xl bg-sf-card/80 p-3 text-sm" role="status" data-testid="reservation-cancel-message">
        {message}
      </p>
    );
  }
  if (!cancellable) return null;
  return (
    <button type="button" onClick={cancel} disabled={busy} className="w-full rounded-2xl py-3 text-sm font-medium ring-1 ring-sf-text/15 disabled:opacity-50" data-testid="reservation-cancel">
      {labels.cancel}
    </button>
  );
}
