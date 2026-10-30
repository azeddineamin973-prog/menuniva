'use client';

import { useEffect, useRef, useState } from 'react';
import { ConnectionBadge, elapsed, playChime, usePolling } from '@/components/dashboard/use-polling';
import { Alert, Button } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { Messages } from '@/i18n';

const f = (t: string, v: Record<string, string | number>) => t.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ''));

type Ticket = {
  id: string;
  status: 'PENDING' | 'PREPARING' | 'READY';
  createdAt: string;
  startedAt: string | null;
  readyAt: string | null;
  order: {
    id: string;
    number: number;
    channel: 'TABLE' | 'TAKEAWAY' | 'DELIVERY';
    customerNotes: string | null;
    customerName: string | null;
    createdAt: string;
    acceptedAt: string | null;
    pickupAt: string | null;
    table: { label: string } | null;
    items: { id: string; quantity: number; nameSnapshot: string; variantNameSnapshot: string | null; notes: string | null; modifiers: { nameSnapshot: string; quantity: number }[] }[];
  };
};
type Payload = { station: { id: string; name: string }; tickets: Ticket[] };

const POLL_MS = 4000;

/** Fullscreen, tablet-friendly kitchen/café display for one station. */
export function KdsBoard({ org, stationId, canUpdate, t }: { org: string; stationId: string; canUpdate: boolean; t: Messages['staff'] }) {
  const { data, online, lastOk, authError, refresh } = usePolling<Payload>(`/api/dashboard/${org}/kds/${stationId}`, POLL_MS);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sound, setSound] = useState(false);
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 10000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!data) return;
    const ids = new Set(data.tickets.filter((t) => t.status === 'PENDING').map((t) => t.id));
    if (seen.current && sound && [...ids].some((id) => !seen.current!.has(id))) playChime();
    seen.current = ids;
  }, [data, sound]);

  const move = async (tk: Ticket, to: Ticket['status']) => {
    setBusy(tk.id);
    setError(null);
    try {
      const r = await fetch(`/api/dashboard/${org}/kds/tickets/${tk.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to, expectedFrom: tk.status }) });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setError(d.error === 'status_conflict' ? t.conflict : t.updateFailed);
      }
    } catch {
      setError(t.updateFailed);
    }
    await refresh();
    setBusy(null);
  };

  if (authError) return <Alert tone="danger">{t.sessionExpired}</Alert>;
  const tickets = data?.tickets ?? [];
  const columns = [
    { key: 'PENDING', title: t.kdsTodo, list: tickets.filter((t) => t.status === 'PENDING') },
    { key: 'PREPARING', title: t.kdsPreparing, list: tickets.filter((t) => t.status === 'PREPARING') },
    { key: 'READY', title: t.kdsReady, list: tickets.filter((t) => t.status === 'READY') },
  ] as const;

  return (
    <div className="min-h-dvh bg-graphite p-4 text-white" data-testid="kds">
      <header className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{data?.station.name ?? 'Station'}</h1>
        <ConnectionBadge online={online} lastOk={lastOk} intervalMs={POLL_MS} labels={{ live: t.live, lost: t.connectionLost }} />
        <div className="ms-auto flex gap-2">
          <Button size="sm" variant="secondary" onClick={() => { setSound(!sound); if (!sound) playChime(); }}>{sound ? `🔔 ${t.soundOn}` : `🔕 ${t.enableSound}`}</Button>
          <Button size="sm" variant="secondary" onClick={() => document.documentElement.requestFullscreen?.()}>{t.fullscreen}</Button>
        </div>
      </header>
      {error && <div className="mb-3"><Alert tone="danger">{error}</Alert></div>}
      <div className="grid gap-4 lg:grid-cols-3">
        {columns.map((col) => (
          <section key={col.key} data-testid={`kds-${col.key}`}>
            <h2 className="mb-2 text-sm font-semibold tracking-wide text-white/60 uppercase">{col.title} · {col.list.length}</h2>
            <div className="space-y-3">
              {col.list.map((tk) => {
                const mins = (now - new Date(tk.order.acceptedAt ?? tk.createdAt).getTime()) / 60000;
                return (
                  <article
                    key={tk.id}
                    className={cn('rounded-2xl border-2 bg-[#20252a] p-4', tk.status === 'READY' ? 'border-success' : mins > 20 ? 'border-danger' : mins > 10 ? 'border-warning' : 'border-white/10')}
                    data-testid="kds-ticket"
                  >
                    <header className="flex items-start justify-between">
                      <div>
                        <p className="text-2xl font-bold tabular-nums">#{tk.order.number}</p>
                        <p className="text-lg">{tk.order.channel === 'TABLE' ? f(t.table, { label: tk.order.table?.label ?? '?' }) : tk.order.channel === 'TAKEAWAY' ? `${t.takeaway} ${tk.order.customerName ?? ''}` : t.delivery}</p>
                      </div>
                      <p className={cn('rounded-lg px-2 py-1 text-lg font-semibold tabular-nums', mins > 20 ? 'bg-danger' : mins > 10 ? 'bg-warning text-graphite' : 'bg-white/10')}>{elapsed(tk.order.acceptedAt ?? tk.createdAt, now)}</p>
                    </header>
                    <ul className="mt-3 space-y-2 text-lg">
                      {tk.order.items.map((i) => (
                        <li key={i.id}>
                          <span className="font-bold text-lime">{i.quantity}×</span> {i.nameSnapshot}
                          {i.variantNameSnapshot && <span className="text-white/70"> · {i.variantNameSnapshot}</span>}
                          {i.modifiers.length > 0 && <span className="block ps-7 text-base text-white/70">{i.modifiers.map((x) => `${x.quantity > 1 ? `${x.quantity}× ` : ''}${x.nameSnapshot}`).join(', ')}</span>}
                          {i.notes && <span className="block ps-7 text-base font-semibold text-amber-300">⚠ {i.notes}</span>}
                        </li>
                      ))}
                    </ul>
                    {tk.order.customerNotes && <p className="mt-2 rounded-lg bg-amber-300/15 px-2 py-1 text-amber-200">{tk.order.customerNotes}</p>}
                    {canUpdate && (
                      <div className="mt-4 flex gap-2">
                        {tk.status === 'PENDING' && <Button size="lg" className="flex-1" disabled={busy === tk.id} onClick={() => move(tk, 'PREPARING')} data-testid="kds-start">{t.kdsStart}</Button>}
                        {tk.status !== 'READY' && <Button size="lg" variant={tk.status === 'PENDING' ? 'secondary' : 'primary'} className="flex-1" disabled={busy === tk.id} onClick={() => move(tk, 'READY')} data-testid="kds-ready">{t.kdsReadyBtn}</Button>}
                        {tk.status === 'READY' && <Button size="lg" variant="secondary" className="flex-1" disabled={busy === tk.id} onClick={() => move(tk, 'PREPARING')}>{t.kdsUndo}</Button>}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          </section>
        ))}
      </div>
      {!data && <p className="text-white/60">{t.loading}</p>}
    </div>
  );
}
