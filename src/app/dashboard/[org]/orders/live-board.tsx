'use client';

import { useEffect, useRef, useState } from 'react';
import { NAV_COUNTS_EVENT } from '@/components/dashboard/sidebar';
import { useFocusParam, useScrollToFocus } from '@/components/dashboard/focus';
import { ConnectionBadge, elapsed, playChime, PollProblemNotice, StaleBanner, useConnectionState, usePolling } from '@/components/dashboard/use-polling';
import { Alert, Badge, Button, Icon, Label, Textarea, type IconName } from '@/components/ui';
import { Dialog } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
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
type Task = { id: string; type: 'CALL_WAITER' | 'REQUEST_BILL' | 'OPEN_TABLE'; status: 'OPEN' | 'ACKNOWLEDGED'; createdAt: string; table: { label: string; area: { name: string } | null } | null };
type Driver = { id: string; name: string };
type Payload = { serverTime: string; orders: Order[]; tasks: Task[]; drivers?: Driver[] };
type ChannelFilter = 'all' | 'TAKEAWAY' | 'DELIVERY' | 'TABLE';

const POLL_MS = 5000;
const COLUMNS: { key: string; title: keyof S; statuses: OrderStatus[] }[] = [
  { key: 'new', title: 'colNew', statuses: ['NEW'] },
  // Accepted and being prepared are one column: the stations' progress shows on the card.
  { key: 'accepted', title: 'colInKitchen', statuses: ['ACCEPTED', 'PREPARING'] },
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
  const { data, health, refresh } = usePolling<Payload>(`/api/dashboard/${org}/orders/live?location=${locationId}`, POLL_MS);
  // Coarse tick: only the tab title depends on it (the badge and banner tick on their own).
  const { stale } = useConnectionState(health, 5000);
  const [muted, setMuted] = useState(false);
  const [soundReady, setSoundReady] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // Phones show one status column at a time (tabs); tablets and desktops show them side by side.
  const [tab, setTab] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<Order | null>(null);
  const [reason, setReason] = useState('');
  const [filter, setFilter] = useState<ChannelFilter>('all');
  const [showDone, setShowDone] = useState(false);
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    setMuted(localStorage.getItem(`mn_mute:${org}`) === '1');
    const saved = localStorage.getItem(`mn_live_filter:${org}`);
    if (saved === 'TAKEAWAY' || saved === 'DELIVERY' || saved === 'TABLE') setFilter(saved);
    const t = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(t);
  }, [org]);

  const orders = data?.orders ?? [];
  // Waiting = NEW: nobody has accepted or rejected it yet. Looking at a card never counts as taking
  // it on (audit OPS-02), so every device keeps the highlight, the title count and the chime.
  const waitingOrders = orders.filter((o) => o.status === 'NEW');
  const tasks = data?.tasks ?? [];
  const openTasks = tasks.filter((t) => t.status === 'OPEN');

  // An attention link (?focus=order-… / task-…) lands on a visible card: a channel filter or the
  // phone's column tab that would hide it gives way once, then the card is scrolled to and marked.
  const focus = useFocusParam();
  const [focusDone, setFocusDone] = useState<string | null>(null);
  if (focus && focus !== focusDone && data) {
    setFocusDone(focus);
    const target = orders.find((o) => `order-${o.id}` === focus);
    if (target) {
      if (filter !== 'all' && target.channel !== filter) setFilter('all');
      setTab(COLUMNS.find((c) => c.statuses.includes(target.status))?.key ?? null);
    }
  }
  useScrollToFocus(focusDone, !!data);

  // Alerts: new order ids → chime + browser notification. Repeats until each order is accepted or
  // rejected (Mute alerts silences this device only).
  useEffect(() => {
    if (!data) return;
    const ids = new Set([...waitingOrders.map((o) => o.id), ...openTasks.map((t) => t.id)]);
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
    if (muted || !soundReady || (waitingOrders.length === 0 && openTasks.length === 0)) return;
    const id = setInterval(playChime, 20000);
    return () => clearInterval(id);
  }, [muted, soundReady, waitingOrders.length, openTasks.length]);

  useEffect(() => {
    // A tab in the background still shows that its list stopped updating.
    const base = waitingOrders.length ? `(${waitingOrders.length}) New orders · MenuNiva` : 'Live Orders · MenuNiva';
    document.title = stale ? `⚠ ${base}` : base;
  }, [waitingOrders.length, stale]);

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
    window.dispatchEvent(new Event(NAV_COUNTS_EVENT));
    setBusy(null);
  };

  const changeStatus = (o: Order, to: OrderStatus) => {
    // Cancelling needs a reason the guest will see: asked in a dialog, not a browser prompt.
    if (to === 'CANCELLED') {
      setReason('');
      setCancelling(o);
      return;
    }
    post(`/api/dashboard/${org}/orders/${o.id}/status`, { to, expectedFrom: o.status }, o.id);
  };
  const confirmCancel = () => {
    const o = cancelling;
    if (!o || !reason.trim()) return;
    setCancelling(null);
    post(`/api/dashboard/${org}/orders/${o.id}/status`, { to: 'CANCELLED', expectedFrom: o.status, reason: reason.trim() }, o.id);
  };

  const pickFilter = (f: ChannelFilter) => {
    setFilter(f);
    localStorage.setItem(`mn_live_filter:${org}`, f);
  };

  if (health.problem) return <PollProblemNotice problem={health.problem} labels={{ expired: t.sessionExpired, forbidden: t.accessRemoved, notFound: t.locationGone, signIn: t.signInAgain }} />;

  const open = orders.filter((o) => o.status !== 'COMPLETED' && o.status !== 'CANCELLED');
  const filters: { key: ChannelFilter; label: string; icon: IconName }[] = [
    { key: 'all', label: t.filterAll, icon: 'orders' },
    { key: 'TAKEAWAY', label: t.filterPickup, icon: 'bag' },
    { key: 'DELIVERY', label: t.filterDelivery, icon: 'truck' },
    // Table orders only get a filter when there are some today.
    ...(orders.some((o) => o.channel === 'TABLE') ? [{ key: 'TABLE' as const, label: t.filterTable, icon: 'qr' as const }] : []),
  ];
  const shown = filter === 'all' ? orders : orders.filter((o) => o.channel === filter);
  const lists = COLUMNS.map((col) => ({ ...col, list: shown.filter((o) => col.statuses.includes(o.status)).sort((a, b) => Number(b.isPriority) - Number(a.isPriority)) }));
  const drivers = data?.drivers ?? [];
  // Default phone tab: the first column with work in it.
  const activeTab = tab ?? lists.find((c) => c.key !== 'done' && c.list.length > 0)?.key ?? 'new';
  return (
    <div className="space-y-4">
      {/* Toolbar: connection health and alert sound. */}
      <div className="flex flex-wrap items-center gap-2">
        <ConnectionBadge health={health} labels={{ live: t.live, lost: t.connectionLost, reconnecting: t.reconnecting, connecting: t.connecting, lastUpdate: t.lastUpdate }} />
        <div className="ms-auto flex flex-wrap items-center gap-2">
          {!soundReady ? (
            <Button
              size="sm"
              variant="secondary"
              icon="volume"
              onClick={() => {
                setSoundReady(true);
                playChime();
                if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
              }}
              title={t.soundOffHint}
            >
              {t.enableSound}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="secondary"
              icon={muted ? 'volumeOff' : 'volume'}
              onClick={() => {
                localStorage.setItem(`mn_mute:${org}`, muted ? '0' : '1');
                setMuted(!muted);
              }}
            >
              {muted ? t.alertsMuted : t.muteAlerts}
            </Button>
          )}
        </div>
      </div>

      {/* Since when the list below has not been updated, while the connection is down. */}
      <StaleBanner health={health} text={t.staleBoard} />

      {/* New orders waiting to be accepted are announced by the sidebar badge (on every page), not a banner here. */}
      {error && <Alert tone="danger">{error}</Alert>}

      {/* Order type: pickup and delivery staff can each see only their own orders. */}
      {data && (
        <div className="mn-scroll -mx-4 overflow-x-auto px-4" role="group" aria-label={t.channelFilter} data-testid="channel-filter">
          <div className="flex w-max gap-1.5">
            {filters.map((f) => {
              const n = f.key === 'all' ? open.length : open.filter((o) => o.channel === f.key).length;
              const fresh = (f.key === 'all' ? waitingOrders : waitingOrders.filter((o) => o.channel === f.key)).length;
              return (
                <button
                  key={f.key}
                  type="button"
                  aria-pressed={filter === f.key}
                  onClick={() => pickFilter(f.key)}
                  className={cn(
                    'flex h-10 items-center gap-2 rounded-lg border px-3.5 text-sm font-semibold whitespace-nowrap transition-colors',
                    filter === f.key ? 'border-ink bg-ink text-bg' : 'border-line bg-surface text-ink-2 hover:bg-surface-2',
                  )}
                  data-testid={`channel-filter-${f.key}`}
                >
                  <Icon name={f.icon} className="size-4" />
                  {f.label}
                  <span className={cn('min-w-5 rounded-md px-1 text-xs tabular-nums', fresh > 0 ? 'bg-lime text-lime-ink' : filter === f.key ? 'bg-white/15' : 'bg-black/5 dark:bg-white/10')}>{n}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {canTasks && tasks.length > 0 && (
        <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3" data-testid="table-requests">
          {tasks.map((task) => (
            <li
              key={task.id}
              id={`task-${task.id}`}
              className={cn(
                'flex scroll-mt-24 flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border px-3 py-2.5 text-sm shadow-xs data-[focused=true]:ring-4 data-[focused=true]:ring-warning/60',
                task.status === 'OPEN' ? 'border-lime/60 bg-accent-soft' : 'border-line bg-surface',
              )}
              data-testid="table-request"
            >
              <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-lg', task.status === 'OPEN' ? 'bg-lime text-lime-ink' : 'bg-surface-2 text-muted')}>
                <Icon name={task.type === 'CALL_WAITER' ? 'bell' : task.type === 'OPEN_TABLE' ? 'tables' : 'bill'} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-ink">{task.type === 'CALL_WAITER' ? t.waiterCalled : task.type === 'OPEN_TABLE' ? t.openTableRequest : t.billRequested}</p>
                <p className="text-xs text-muted">
                  {f(t.table, { label: task.table?.label ?? '?' })}
                  {task.table?.area ? ` · ${task.table.area.name}` : ''} · {elapsed(task.createdAt, now)}
                </p>
              </div>
              <div className="flex gap-1.5">
                {task.status === 'OPEN' && (
                  <Button size="sm" variant="secondary" disabled={busy === task.id} onClick={() => post(`/api/dashboard/${org}/tasks/${task.id}`, { to: 'ACKNOWLEDGED' }, task.id)} data-testid="task-ack">
                    {t.onMyWay}
                  </Button>
                )}
                <Button size="sm" variant="dark" icon="check" disabled={busy === task.id} onClick={() => post(`/api/dashboard/${org}/tasks/${task.id}`, { to: 'DONE' }, task.id)} data-testid="task-done">
                  {t.done}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {!data ? (
        <div className="grid gap-3 md:grid-cols-[repeat(auto-fit,minmax(17rem,1fr))]" role="status" aria-busy="true">
          <span className="sr-only">{t.loading}</span>
          {[0, 1, 2].map((i) => (
            <div key={i} className={cn('space-y-2 rounded-xl border border-line bg-surface-2/50 p-2', i > 0 && 'hidden md:block')}>
              <Skeleton className="mx-2 my-2 h-4 w-24 bg-surface-3" />
              <Skeleton className="h-36 w-full bg-surface" />
              <Skeleton className="h-28 w-full bg-surface" />
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className="mn-scroll sticky top-14 z-20 -mx-4 overflow-x-auto border-b border-line bg-bg/90 px-4 py-2 backdrop-blur-md md:hidden" role="tablist" aria-label={t.statusTabs} data-testid="status-tabs">
            <div className="flex gap-1.5">
              {lists.map((col) => (
                <button
                  key={col.key}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === col.key}
                  aria-controls={`col-${col.key}`}
                  onClick={() => setTab(col.key)}
                  className={cn(
                    'flex h-10 shrink-0 items-center gap-2 rounded-lg border px-3 text-sm font-medium whitespace-nowrap transition-colors',
                    activeTab === col.key ? 'border-ink bg-ink text-bg' : 'border-line bg-surface text-ink-2',
                  )}
                  data-testid={`status-tab-${col.key}`}
                >
                  <span className={cn('size-2 rounded-full', COLUMN_STYLE[col.key].dot)} aria-hidden />
                  {t[col.title]}
                  <span className={cn('min-w-5 rounded-md px-1 text-xs tabular-nums', col.key === 'new' && col.list.length > 0 ? 'bg-lime text-lime-ink' : 'bg-black/5 dark:bg-white/10', activeTab === col.key && col.key !== 'new' && 'bg-white/15')}>
                    {col.list.length}
                  </span>
                </button>
              ))}
            </div>
          </div>
          {/* Three working columns (New → In preparation → Ready); completed orders below, folded. */}
          <div className="grid items-start gap-4 md:grid-cols-3">
            {lists.map((col) => (
              <section
                key={col.key}
                id={`col-${col.key}`}
                className={cn('scroll-mt-32 rounded-2xl bg-surface-2/60', col.key === 'done' && 'md:col-span-full', activeTab !== col.key && 'hidden md:block')}
                data-testid={`column-${col.key}`}
                aria-label={t[col.title]}
              >
                <h2 className="flex items-center gap-2 px-4 pt-3.5 pb-2.5 text-sm font-semibold text-ink">
                  <span className={cn('size-2.5 rounded-full', COLUMN_STYLE[col.key].dot)} aria-hidden />
                  {t[col.title]}
                  <span className={cn('rounded-md px-1.5 text-xs tabular-nums', col.key === 'new' && col.list.length > 0 ? 'bg-lime text-lime-ink' : 'bg-surface text-muted shadow-xs')}>{col.list.length}</span>
                  {col.key === 'done' && col.list.length > 0 && (
                    <button type="button" onClick={() => setShowDone((v) => !v)} aria-expanded={showDone} className="ms-auto hidden min-h-9 items-center gap-1 rounded-lg px-2.5 text-[13px] font-medium text-muted hover:bg-surface hover:text-ink md:inline-flex" data-testid="toggle-done">
                      {showDone ? t.hideDone : t.showDone}
                      <Icon name="chevronDown" className={cn('size-4 transition-transform', showDone && 'rotate-180')} />
                    </button>
                  )}
                </h2>
                <div className={cn('space-y-3 px-2.5 pb-2.5', col.key === 'done' && col.list.length > 0 && 'md:grid md:grid-cols-[repeat(auto-fill,minmax(17rem,1fr))] md:items-start md:gap-3 md:space-y-0', col.key === 'done' && !showDone && 'md:hidden')}>
                  {col.list.length === 0 && (
                    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-line px-4 py-7 text-center">
                      <Icon name={COLUMN_STYLE[col.key].icon} className="size-5 text-muted/70" />
                      <p className="text-xs text-muted">{t[COLUMN_STYLE[col.key].empty]}</p>
                    </div>
                  )}
                  {col.list.map((o) => (
                    <OrderCard
                      key={o.id}
                      o={o}
                      org={org}
                      now={now}
                      tag={tag}
                      t={t}
                      canManage={canManage}
                      busy={busy === o.id}
                      drivers={drivers}
                      onStatus={(to) => changeStatus(o, to)}
                      onPriority={() => post(`/api/dashboard/${org}/orders/${o.id}/status`, { action: 'priority', isPriority: !o.isPriority }, o.id)}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        </>
      )}

      <Dialog
        open={!!cancelling}
        onClose={() => setCancelling(null)}
        title={f(cancelling?.status === 'NEW' ? t.rejectTitle : t.cancelOrderTitle, { n: cancelling?.number ?? '' })}
        testId="cancel-order-dialog"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCancelling(null)}>
              {t.keepOrder}
            </Button>
            <Button variant="danger" disabled={!reason.trim()} onClick={confirmCancel} data-testid="confirm-cancel">
              {cancelling?.status === 'NEW' ? t.reject : t.confirmCancel}
            </Button>
          </>
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            confirmCancel();
          }}
        >
          <p className="mb-1.5 text-[13px] font-medium text-ink">{t.quickReasons}</p>
          <div className="mb-3 flex flex-wrap gap-1.5" data-testid="quick-reasons">
            {[t.reasonBusy, t.reasonClosing, t.reasonItem, ...(cancelling?.channel === 'DELIVERY' ? [t.reasonArea] : [])].map((r) => (
              <button key={r} type="button" onClick={() => setReason(r)} className={cn('rounded-full border px-3 py-1.5 text-start text-xs font-medium transition-colors', reason === r ? 'border-ink bg-ink text-bg' : 'border-line bg-surface text-ink-2 hover:bg-surface-2')}>
                {r}
              </button>
            ))}
          </div>
          <Label htmlFor="cancel-reason">{t.cancelPrompt}</Label>
          <Textarea id="cancel-reason" value={reason} onChange={(e) => setReason(e.target.value.slice(0, 300))} maxLength={300} required data-testid="cancel-reason" />
        </form>
      </Dialog>
    </div>
  );
}

const COLUMN_STYLE: Record<string, { dot: string; icon: IconName; empty: keyof S }> = {
  new: { dot: 'bg-lime', icon: 'inbox', empty: 'emptyNew' },
  accepted: { dot: 'bg-warning', icon: 'flame', empty: 'emptyPreparing' },
  ready: { dot: 'bg-success', icon: 'bell', empty: 'emptyReady' },
  done: { dot: 'bg-muted', icon: 'checkCircle', empty: 'emptyDone' },
};
/** Pickup and delivery look different at a glance: their own colour, icon and label. */
const CHANNEL_STYLE: Record<string, { icon: IconName; tag: string; edge: string }> = {
  TABLE: { icon: 'qr', tag: 'bg-surface-2 text-ink-2', edge: 'before:bg-line' },
  TAKEAWAY: { icon: 'bag', tag: 'bg-warning/12 text-warning', edge: 'before:bg-warning' },
  DELIVERY: { icon: 'truck', tag: 'bg-info/12 text-info', edge: 'before:bg-info' },
};
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/**
 * One order, read in this order: number, type and waiting time → customer → WHEN (pickup time) or
 * WHERE (delivery address) → dishes with their station → total and how it is paid → the one next
 * step, as a large button. Rarely used actions stay small underneath.
 */
function OrderCard({
  o,
  org,
  now,
  tag,
  t,
  canManage,
  busy,
  drivers,
  onStatus,
  onPriority,
}: {
  o: Order;
  org: string;
  now: number;
  tag: string;
  t: S;
  canManage: boolean;
  busy: boolean;
  /** The location's drivers: they receive delivery orders automatically and confirm pickup themselves. */
  drivers: Driver[];
  onStatus: (to: OrderStatus) => void;
  onPriority: () => void;
}) {
  // Highlighted (and Accept / Reject offered) until someone accepts or rejects it.
  const waiting = o.status === 'NEW';
  const ticketsPending = o.tickets.some((t) => t.status !== 'READY' && t.status !== 'CANCELLED');
  const style = CHANNEL_STYLE[o.channel] ?? CHANNEL_STYLE.TABLE;
  const channelLabel = o.channel === 'TABLE' ? f(t.table, { label: o.table?.label ?? '?' }) : o.channel === 'TAKEAWAY' ? t.takeaway : t.delivery;
  const actions = nextStatuses(o.channel, o.status);
  // The single forward step (Accept, Start, Ready, Out for delivery, Delivered, Complete).
  // READY is skipped while stations are still working: the server refuses it then.
  // With drivers, pickup and delivery are confirmed on the driver's phone, not here.
  const driverConfirms = o.channel === 'DELIVERY' && drivers.length > 0;
  const forward = actions.filter((to) => to !== 'CANCELLED' && !(to === 'READY' && ticketsPending) && !(driverConfirms && (to === 'OUT_FOR_DELIVERY' || to === 'DELIVERED')));
  const primary = forward.find((to) => to !== 'PREPARING') ?? forward[0];
  const finished = o.status === 'COMPLETED' || o.status === 'CANCELLED';
  const minutes = (now - new Date(o.createdAt).getTime()) / 60000;
  // Waiting time turns amber after 10 and red after 20 minutes while the order is still open.
  const age = finished ? 'bg-surface-2 text-muted' : minutes > 20 ? 'bg-danger/10 text-danger' : minutes > 10 ? 'bg-warning/10 text-warning' : 'bg-surface-2 text-ink-2';
  const items = o.items.filter((i) => !i.voidedAt);
  const itemCount = items.reduce((n, i) => n + i.quantity, 0);
  const payment = o.channel === 'TABLE' ? null : o.paymentMethodIntent === 'CARD_TERMINAL' ? t.payCard : o.paymentMethodIntent === 'CASH_ON_DELIVERY' ? t.payCash : t.payCounter;
  const driverId = o.delivery?.driverMembershipId ?? '';
  const driverName = drivers.find((d) => d.id === driverId)?.name;
  const ticketLabel = (s: string) => (s === 'READY' ? t.colReady : s === 'PREPARING' ? t.kdsPreparing : s === 'PENDING' ? t.kdsTodo : s.toLowerCase());
  return (
    <article
      id={`order-${o.id}`}
      className={cn(
        'relative scroll-mt-32 overflow-hidden rounded-xl bg-surface p-4 ps-5 shadow-xs ring-1 transition-shadow before:absolute before:inset-y-0 before:start-0 before:w-1 data-[focused=true]:ring-4 data-[focused=true]:ring-warning/70',
        style.edge,
        waiting ? 'shadow-md ring-2 ring-lime' : 'ring-line',
        o.status === 'CANCELLED' && 'opacity-60',
      )}
      data-testid="order-card"
      data-order-number={o.number}
      data-status={o.status}
      data-channel={o.channel}
    >
      <header className="flex items-start justify-between gap-2">
        <p className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="text-lg leading-6 font-bold text-ink tabular-nums">#{o.number}</span>
          <span className={cn('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-semibold', style.tag)} data-testid="channel-tag">
            <Icon name={style.icon} className="size-3.5" />
            {channelLabel}
          </span>
          {waiting && <Badge tone="lime" dot>{t.colNew}</Badge>}
          {o.isPriority && (
            <Badge tone="danger" data-testid="priority-badge">
              {t.priority}
            </Badge>
          )}
        </p>
        <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-semibold whitespace-nowrap tabular-nums', age)} title={hhmm(o.createdAt)}>
          <Icon name="clock" className="size-3" />
          {elapsed(o.createdAt, now)}
        </span>
      </header>

      {(o.customerName || o.customerPhone) && (
        <div className="mt-2 flex items-baseline justify-between gap-2">
          {o.customerName && <p className="min-w-0 truncate text-[15px] font-semibold text-ink">{o.customerName}</p>}
          {o.customerPhone && (
            <a href={`tel:${o.customerPhone.replace(/\s/g, '')}`} className="shrink-0 text-[13px] text-ink-2 tabular-nums underline-offset-2 hover:underline" dir="ltr">
              {o.customerPhone}
            </a>
          )}
        </div>
      )}
      {o.table?.area && <p className="text-xs text-muted">{o.table.area.name}</p>}

      {/* WHEN (pickup) or WHERE (delivery): the line staff look for first. */}
      {o.channel === 'TAKEAWAY' && o.pickupAt && (
        <p className="mt-2.5 flex items-center gap-2 rounded-lg bg-warning/10 px-2.5 py-1.5 text-sm font-semibold text-warning" data-testid="pickup-time">
          <Icon name="clock" className="size-4" />
          {f(t.pickupAt, { time: hhmm(o.pickupAt) })}
        </p>
      )}
      {o.delivery && (
        <p className="mt-2.5 flex items-start gap-2 rounded-lg bg-info/8 px-2.5 py-1.5 text-sm text-ink" data-testid="delivery-address">
          <Icon name="map" className="mt-0.5 size-4 shrink-0 text-info" />
          <span className="min-w-0">
            <span className="font-semibold">{o.delivery.addressLine}</span>
            <span className="block text-[13px] text-ink-2">
              {o.delivery.postalCode} {o.delivery.city}
            </span>
            {o.delivery.notes && <span className="block text-xs wrap-anywhere text-warning">“{o.delivery.notes}”</span>}
          </span>
        </p>
      )}

      {o.channel === 'TABLE' && o.tableSession && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-muted" data-testid="order-provenance">
          <Icon name={o.tableSessionDevice ? 'smartphone' : 'tables'} className="size-3.5 shrink-0" />
          {o.tableSessionDevice ? f(t.viaTablePin, { time: hhmm(o.tableSessionDevice.enrolledAt) }) : f(t.seatingOpened, { time: hhmm(o.tableSession.openedAt) })}
        </p>
      )}
      <ul className="mt-3 space-y-1.5 text-sm">
        {items.map((i) => (
          <li key={i.id} className="text-ink">
            <span className="flex items-baseline gap-2">
              <span className="w-6 shrink-0 font-bold tabular-nums">{i.quantity}×</span>
              <span className="min-w-0 flex-1">
                {i.nameSnapshot}
                {i.variantNameSnapshot && <span className="text-muted"> · {i.variantNameSnapshot}</span>}
              </span>
              {i.station && <span className="shrink-0 text-[11px] text-muted">{i.station.name}</span>}
            </span>
            {i.modifiers.length > 0 && <span className="block ps-8 text-xs text-muted">{i.modifiers.map((x) => `${x.quantity > 1 ? `${x.quantity}× ` : ''}${x.nameSnapshot}`).join(', ')}</span>}
            {i.notes && <span className="block ps-8 text-xs font-medium wrap-anywhere text-warning">“{i.notes}”</span>}
            {/* No station: either nothing to prepare (ready from the start, handed over at the
                counter), or a counter item front of house still has to check before Ready. */}
            {!i.stationId &&
              (i.prepStatus === 'READY' || i.prepStatus === 'SERVED' ? (
                <span className="block ps-8 text-xs text-muted" data-testid="item-counter">
                  {t.counterItem}
                </span>
              ) : (
                i.prepStatus !== 'CANCELLED' && (
                  <span className="block ps-8 text-xs text-warning" data-testid="item-no-station">
                    <Icon name="alert" className="me-1 inline size-3.5 align-[-2px]" />
                    {t.noStation}
                  </span>
                )
              ))}
          </li>
        ))}
      </ul>
      {o.customerNotes && (
        <p className="mt-2.5 rounded-lg bg-warning/10 px-2.5 py-1.5 text-xs wrap-anywhere text-warning">
          {t.note}: {o.customerNotes}
        </p>
      )}
      {o.tickets.length > 0 && !finished && (
        <div className="mt-2.5 flex flex-wrap gap-1" data-testid="station-tickets">
          {o.tickets.map((tk) => (
            <Badge key={tk.id} dot tone={tk.status === 'READY' ? 'success' : tk.status === 'PREPARING' ? 'warning' : tk.status === 'CANCELLED' ? 'danger' : 'neutral'} className="max-w-full truncate">
              {tk.station.name} · {ticketLabel(tk.status)}
            </Badge>
          ))}
        </div>
      )}
      {o.status === 'CANCELLED' && o.cancelReason && <p className="mt-2 text-xs text-danger">{f(t.cancelled, { reason: o.cancelReason })}</p>}

      {/* Driver: set once (Staff page), never picked per order. One driver gets every delivery;
          with several, the first to confirm pickup takes it. */}
      {driverConfirms && !finished && o.status !== 'DELIVERED' && (
        <p className="mt-3 flex items-center gap-2 text-sm" data-testid="live-driver">
          <Icon name="truck" className="size-4 shrink-0 text-info" />
          <span className="min-w-0 font-medium text-ink">{driverName ? f(t.driverNamed, { name: driverName }) : drivers.length === 1 ? f(t.driverNamed, { name: drivers[0].name }) : t.driverAnyone}</span>
        </p>
      )}

      <div className="mt-3 flex items-center justify-between gap-2 border-t border-line pt-3">
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span className="text-base font-bold text-ink tabular-nums">{formatCents(o.totalCents, tag)}</span>
          <span className="truncate text-xs text-muted">· {f(t.itemsCount, { n: itemCount })}</span>
        </span>
        <span className="flex items-center gap-1">
          {o.tableSessionId && (
            <a href={`/dashboard/${org}/bills/${o.tableSessionId}`} className="inline-flex min-h-8 items-center rounded-md px-1.5 text-xs font-medium text-muted underline underline-offset-2 hover:bg-surface-2 hover:text-ink pointer-coarse:min-h-10" data-testid="order-bill-link">
              {t.openBill}
            </a>
          )}
          <Badge tone={o.paymentStatus === 'PAID' ? 'success' : o.paymentStatus === 'PARTIALLY_PAID' ? 'warning' : 'neutral'}>
            {o.paymentStatus === 'UNPAID' ? (payment ?? t.notPaid) : o.paymentStatus === 'PAID' ? t.paid : o.paymentStatus === 'PARTIALLY_PAID' ? t.partiallyPaid : o.paymentStatus}
          </Badge>
        </span>
      </div>

      {canManage && !finished && (
        <div className="mt-3 space-y-2">
          {primary ? (
            <Button
              size="lg"
              variant={primary === 'ACCEPTED' ? 'primary' : 'dark'}
              icon={primary === 'ACCEPTED' ? 'check' : undefined}
              disabled={busy}
              onClick={() => onStatus(primary)}
              className="w-full"
              data-testid={`action-${primary}`}
            >
              {t[ACTION_KEY[primary]!]}
            </Button>
          ) : ticketsPending ? (
            <p className="flex items-center justify-center gap-2 rounded-lg bg-surface-2 px-3 py-2.5 text-sm font-medium text-ink-2" data-testid="waiting-stations">
              <Icon name="flame" className="size-4 text-warning" />
              {t.waitingStations}
            </p>
          ) : (
            driverConfirms &&
            (o.status === 'READY' || o.status === 'OUT_FOR_DELIVERY') && (
              <p className="flex flex-col items-center justify-center rounded-lg bg-info/8 px-3 py-2.5 text-center text-sm font-medium text-ink-2" data-testid="waiting-driver">
                <span className="flex items-center gap-2">
                  <Icon name="truck" className="size-4 text-info" />
                  {o.status === 'READY' ? t.waitingDriver : t.outForDelivery}
                </span>
                <span className="text-xs font-normal text-muted">{t.driverConfirms}</span>
              </p>
            )
          )}
          {(['NEW', 'ACCEPTED', 'PREPARING'].includes(o.status) || actions.includes('CANCELLED')) && (
            <div className="flex flex-wrap items-center gap-1">
              {['NEW', 'ACCEPTED', 'PREPARING'].includes(o.status) && (
                <Button size="sm" variant="ghost" icon="flame" disabled={busy} onClick={onPriority} data-testid="toggle-priority">
                  {o.isPriority ? t.removePriority : t.markPriority}
                </Button>
              )}
              {actions.includes('CANCELLED') && (
                <Button size="sm" variant="dangerGhost" disabled={busy} onClick={() => onStatus('CANCELLED')} className="ms-auto" data-testid="action-CANCELLED">
                  {o.status === 'NEW' ? t.reject : t.cancel}
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </article>
  );
}
