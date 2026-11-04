'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { OFFLINE_AFTER_MS } from '@/lib/poll-health';
import { elapsed } from './use-polling';

/**
 * Re-reads a server-rendered page every `seconds` while it is visible, and as soon as the tab or
 * the connection comes back. Used where staff wait for work to arrive (driver view).
 *
 * With `renderedAt` (a value that changes on every server render) and `staleText`, it also says
 * when the page stopped updating: no new render for two refreshes (at least 30 s) shows
 * `staleText` ("Not updated since {time} ({ago} ago)…") until a refresh gets through.
 */
export function AutoRefresh({ seconds = 20, renderedAt, staleText }: { seconds?: number; renderedAt?: string; staleText?: string }) {
  const router = useRouter();
  const receivedAt = useRef<number | null>(null);
  // Which render was found stale: a newer render no longer matches, so the notice goes at once.
  const [stale, setStale] = useState<{ render: string; since: number; now: number } | null>(null);
  useEffect(() => {
    receivedAt.current = Date.now();
  }, [renderedAt]);
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === 'visible' && navigator.onLine) router.refresh();
    };
    const check = () => {
      const since = receivedAt.current;
      if (renderedAt && since !== null && Date.now() - since >= Math.max(OFFLINE_AFTER_MS, seconds * 2500)) setStale({ render: renderedAt, since, now: Date.now() });
    };
    const id = setInterval(tick, seconds * 1000);
    const checkId = setInterval(check, 5000);
    document.addEventListener('visibilitychange', tick);
    window.addEventListener('online', tick);
    return () => {
      clearInterval(id);
      clearInterval(checkId);
      document.removeEventListener('visibilitychange', tick);
      window.removeEventListener('online', tick);
    };
  }, [router, seconds, renderedAt]);

  if (!staleText || !stale || stale.render !== renderedAt) return null;
  const time = new Date(stale.since).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return (
    <p className="mb-4 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm font-medium text-warning" role="alert" data-testid="stale-banner">
      <span className="mt-1.5 h-2 w-2 shrink-0 animate-pulse rounded-full bg-warning" aria-hidden />
      {staleText.replace('{time}', time).replace('{ago}', elapsed(new Date(stale.since).toISOString(), stale.now))}
    </p>
  );
}
