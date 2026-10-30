'use client';

import { useEffect, useRef, useState } from 'react';
import { ConnectionBadge, elapsed, playChime, usePolling } from '@/components/dashboard/use-polling';
import { Alert, Badge, Button } from '@/components/ui';
import type { OrderStatus } from '@/generated/prisma/enums';
import { cn } from '@/lib/cn';
import { formatCents } from '@/lib/money';
import { nextStatuses } from '@/lib/order-state';
import type { LiveOrder } from '@/server/services/orders';
import type { Messages } from '@/i18n';

type S = Messages['staff'];
const f = (t: string, v: Record<string, string | number>) => t.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ''));

type J<T> = T extends Date ? string : T extends (infer U)[] ? J<U>[] : T extends object ? { [K in keyof T]: J<T[K]> } : T;
type Order = J<LiveOrder>;
type Task = { id: string; type: 'CALL_WAITER' | 'REQUEST_BILL'; status: 'OPEN' | 'ACKNOWLEDGED'; createdAt: string; table: { label: string; area: { name: string } | null } | null };
type Payload = { serverTime: string; orders: Order[]; tasks: Task[] };

const POLL_MS = 5000;
const COLUMNS: { key: string; title: keyof S; statuses: OrderStatus[] }[] = [
  { key: 'new', title: 'colNew', statuses: ['NEW'] },
  { key: 'accepted', title: 'colAccepted', statuses: ['ACCEPTED'] },
  { key: 'preparing', title: 'colPreparing', statuses: ['PREPARING'] },
  { key: 'ready', title: 'colReady', statuses: ['READY', 'OUT_FOR_DELIVERY', 'DELIVERED'] },
  { key: 'done', title: 'colDone', statuses: ['COMPLETED', 'CANCELLED'] },
];
const ACTION_KEY: Partial<Record<OrderStatus, keyof S>> = {
  ACCEPTED: 'accept',
  PREPARING: 'startPreparing',
  READY: 'markReady',
  OUT_FOR_DELIVERY: 'outForDelivery',
  DELIVERED: 'delivered',
  COMPLETED: 'complete',
  CANCELLED: 'cancel',
};

export function LiveBoard({ org, locationId, canManage, canTasks, tag, t }: { org: string; locationId: string; canManage: boolean; canTasks: boolean; tag: string; t: S }) {
  const { data, online, lastOk, authError, refresh } = usePolling<Payload>(`/api/dashboard/${org}/orders/live?location=${locationId}`, POLL_MS);
  const [muted, setMuted] = useState(false);
  const [soundReady, setSoundReady] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    setMuted(localStorage.getItem(`mn_mute:${org}`) === '1');
    const t = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(t);
  }, [org]);

  const orders = data?.orders ?? [];
  const unacknowledged = orders.filter((o) => o.status === 'NEW' && !o.acknowledgedAt);
  const tasks = data?.tasks ?? [];
  const openTasks = tasks.filter((t) => t.status === 'OPEN');

  // Alerts: new order ids → chime + browser notification. Repeats while unacknowledged.
  useEffect(() => {
    if (!data) return;
    const ids = new Set([...unacknowledged.map((o) => o.id), ...openTasks.map((t) => t.id)]);
    if (seen.current === null) {
      seen.current = ids;
      return;
    }
    const fresh = [...ids].filter((id) => !seen.current!.has(id));
    seen.current = ids;
    if (fresh.length) {
      if (!muted && soundReady) playChime();
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('MenuNiva', { body: `${fresh.length} new order(s) or table request(s)`, tag: 'menuniva-new' });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  useEffect(() => {
    if (muted || !soundReady || (unacknowledged.length === 0 && openTasks.length === 0)) return;
    const id = setInterval(playChime, 20000);
    return () => clearInterval(id);
  }, [muted, soundReady, unacknowledged.length, openTasks.length]);

  useEffect(() => {
    document.title = unacknowledged.length ? `(${unacknowledged.length}) New orders · MenuNiva` : 'Live Orders · MenuNiva';
  }, [unacknowledged.length]);

  const post = async (url: string, body: unknown, key: string) => {
    setBusy(key);
    setError(null);
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) setError(d.error === 'status_conflict' ? t.conflict : typeof d.error === 'string' && d.error !== 'server_error' ? d.error : t.updateFailed);
    } catch {
      setError(t.updateFailed);
    }
    await refresh();
    setBusy(null);
  };

  const changeStatus = (o: Order, to: OrderStatus) => {
    let reason: string | undefined;
    if (to === 'CANCELLED') {
      reason = window.prompt(t.cancelPrompt) ?? undefined;
      if (!reason?.trim()) return;
    }
    post(`/api/dashboard/${org}/orders/${o.id}/status`, { to, expectedFrom: o.status, reason }, o.id);
  };

  if (authError) return <Alert tone="danger">{t.sessionExpired}</Alert>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <ConnectionBadge online={online} lastOk={lastOk} intervalMs={POLL_MS} labels={{ live: t.live, lost: t.connectionLost }} />
        {unacknowledged.length > 0 && (
          <Badge tone="lime" className="animate-pulse text-sm" data-testid="unread-count">
            {f(t.newOrdersWaiting, { n: unacknowledged.length })}
          </Badge>
        )}
        <div className="ms-auto flex flex-wrap gap-2">
          {!soundReady ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setSoundReady(true);
                playChime();
                if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
              }}
            >
              🔔 {t.enableSound}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                localStorage.setItem(`mn_mute:${org}`, muted ? '0' : '1');
                setMuted(!muted);
              }}
            >
              {muted ? `🔕 ${t.alertsMuted}` : `🔔 ${t.muteAlerts}`}
            </Button>
          )}
        </div>
      </div>
      {!soundReady && <p className="text-xs text-muted">{t.soundHint}</p>}
      {error && <Alert tone="danger">{error}</Alert>}

      {canTasks && tasks.length > 0 && (
        <div className="flex flex-wrap gap-2" data-testid="table-requests">
          {tasks.map((task) => (
            <div key={task.id} className={cn('flex items-center gap-2 rounded-2xl border px-3 py-2 text-sm', task.status === 'OPEN' ? 'border-lime bg-lime/20' : 'border-line bg-surface')}>
              <strong>{task.type === 'CALL_WAITER' ? `🙋 ${t.waiterCalled}` : `🧾 ${t.billRequested}`}</strong>
              <span>{f(t.table, { label: task.table?.label ?? '?' })}</span>
              <span className="text-xs text-muted">{elapsed(task.createdAt, now)}</span>
              {task.status === 'OPEN' && <Button size="sm" variant="secondary" disabled={busy === task.id} onClick={() => post(`/api/dashboard/${org}/tasks/${task.id}`, { to: 'ACKNOWLEDGED' }, task.id)} data-testid="task-ack">{t.onMyWay}</Button>}
              <Button size="sm" variant="dark" disabled={busy === task.id} onClick={() => post(`/api/dashboard/${org}/tasks/${task.id}`, { to: 'DONE' }, task.id)} data-testid="task-done">{t.done}</Button>
            </div>
          ))}
        </div>
      )}

      {!data ? (
        <p className="text-sm text-muted">{t.loading}</p>
      ) : (
        <div className="grid gap-4 overflow-x-auto pb-2 lg:grid-cols-5">
          {COLUMNS.map((col) => {
            const list = orders.filter((o) => col.statuses.includes(o.status));
            return (
              <section key={col.key} className="min-w-[260px] rounded-[var(--radius-card)] bg-surface-2/70 p-2" data-testid={`column-${col.key}`}>
                <h2 className="flex items-center justify-between px-2 py-1.5 text-sm font-semibold">
                  {t[col.title]} <span className="rounded-full bg-surface px-2 text-xs tabular-nums">{list.length}</span>
                </h2>
                <div className="space-y-2">
                  {list.length === 0 && <p className="px-2 py-4 text-center text-xs text-muted">—</p>}
                  {list.map((o) => (
                    <OrderCard key={o.id} o={o} org={org} now={now} tag={tag} t={t} canManage={canManage} busy={busy === o.id} onStatus={(to) => changeStatus(o, to)} onAck={() => post(`/api/dashboard/${org}/orders/${o.id}/status`, { action: 'acknowledge' }, o.id)} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function OrderCard({ o, org, now, tag, t, canManage, busy, onStatus, onAck }: { o: Order; org: string; now: number; tag: string; t: S; canManage: boolean; busy: boolean; onStatus: (to: OrderStatus) => void; onAck: () => void }) {
  const unack = o.status === 'NEW' && !o.acknowledgedAt;
  const ticketsPending = o.tickets.some((t) => t.status !== 'READY' && t.status !== 'CANCELLED');
  const where = o.channel === 'TABLE' ? f(t.table, { label: o.table?.label ?? '?' }) : o.channel === 'TAKEAWAY' ? `${t.takeaway}${o.customerName ? ` · ${o.customerName}` : ''}` : `${t.delivery}${o.delivery ? ` · ${o.delivery.postalCode}` : ''}`;
  return (
    <article className={cn('rounded-2xl border bg-surface p-3 shadow-sm', unack ? 'border-lime ring-2 ring-lime/60' : 'border-line', o.status === 'CANCELLED' && 'opacity-60')} data-testid="order-card" data-order-number={o.number} data-status={o.status}>
      <header className="flex items-start justify-between gap-2">
        <div>
          <p className="text-lg font-semibold tabular-nums">#{o.number}</p>
          <p className="text-sm font-medium">{where}</p>
          {o.table?.area && <p className="text-xs text-muted">{o.table.area.name}</p>}
        </div>
        <div className="text-end">
          <p className="text-xs text-muted">{new Date(o.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
          <p className="text-xs font-medium">{elapsed(o.createdAt, now)}</p>
        </div>
      </header>
      <ul className="mt-2 space-y-1 text-sm">
        {o.items.filter((i) => !i.voidedAt).map((i) => (
          <li key={i.id}>
            <span className="font-semibold tabular-nums">{i.quantity}×</span> {i.nameSnapshot}
            {i.variantNameSnapshot && <span className="text-muted"> · {i.variantNameSnapshot}</span>}
            {i.modifiers.length > 0 && <span className="block ps-5 text-xs text-muted">{i.modifiers.map((x) => `${x.quantity > 1 ? `${x.quantity}× ` : ''}${x.nameSnapshot}`).join(', ')}</span>}
            {i.notes && <span className="block ps-5 text-xs font-medium text-warning">“{i.notes}”</span>}
          </li>
        ))}
      </ul>
      {o.customerNotes && <p className="mt-2 rounded-lg bg-warning/10 px-2 py-1 text-xs text-warning">{t.note}: {o.customerNotes}</p>}
      {o.tickets.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {o.tickets.map((t) => (
            <Badge key={t.id} tone={t.status === 'READY' ? 'success' : t.status === 'PREPARING' ? 'info' : t.status === 'CANCELLED' ? 'danger' : 'neutral'}>
              {t.station.name}: {t.status.toLowerCase()}
            </Badge>
          ))}
        </div>
      )}
      {o.status === 'CANCELLED' && o.cancelReason && <p className="mt-2 text-xs text-danger">{f(t.cancelled, { reason: o.cancelReason })}</p>}
      <div className="mt-2 flex items-center justify-between text-sm">
        <span className="flex items-center gap-2">
          <span className="font-semibold tabular-nums">{formatCents(o.totalCents, tag)}</span>
          {o.tableSessionId && <a href={`/dashboard/${org}/bills/${o.tableSessionId}`} className="text-xs underline" data-testid="order-bill-link">{t.openBill}</a>}
        </span>
        <Badge tone={o.paymentStatus === 'PAID' ? 'success' : o.paymentStatus === 'PARTIALLY_PAID' ? 'warning' : 'neutral'}>{o.paymentStatus === 'UNPAID' ? t.notPaid : o.paymentStatus === 'PAID' ? t.paid : o.paymentStatus === 'PARTIALLY_PAID' ? t.partiallyPaid : o.paymentStatus}</Badge>
      </div>
      {canManage && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {unack && <Button size="sm" variant="secondary" disabled={busy} onClick={onAck}>{t.seen}</Button>}
          {nextStatuses(o.channel, o.status).map((to) => (
            <Button
              key={to}
              size="sm"
              variant={to === 'CANCELLED' ? 'ghost' : to === 'ACCEPTED' ? 'primary' : 'dark'}
              disabled={busy || (to === 'READY' && ticketsPending)}
              title={to === 'READY' && ticketsPending ? t.waitingStations : undefined}
              onClick={() => onStatus(to)}
              data-testid={`action-${to}`}
            >
              {t[ACTION_KEY[to]!]}
            </Button>
          ))}
        </div>
      )}
    </article>
  );
}
