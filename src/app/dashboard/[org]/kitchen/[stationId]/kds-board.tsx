'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useFocusParam, useScrollToFocus } from '@/components/dashboard/focus';
import { ConnectionBadge, elapsed, playChime, PollProblemNotice, StaleBanner, usePolling } from '@/components/dashboard/use-polling';
import { Alert, Button, Icon, type IconName } from '@/components/ui';
import { levelFor, ticketStartBy, type AttentionLevel, type Threshold } from '@/lib/attention';
import { cn } from '@/lib/cn';
import type { Messages } from '@/i18n';

const f = (t: string, v: Record<string, string | number>) => t.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ''));

type Ticket = {
  id: string;
  /** CANCELLED: staff removed this station's last item; shown for a while so the cook stops. */
  status: 'PENDING' | 'PREPARING' | 'READY' | 'CANCELLED';
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
    isPriority?: boolean;
    table: { label: string } | null;
    items: {
      id: string;
      quantity: number;
      nameSnapshot: string;
      variantNameSnapshot: string | null;
      notes: string | null;
      modifiers: { nameSnapshot: string; quantity: number }[];
      /** Removed by staff after this station got the ticket. */
      voidedAt: string | null;
      voidReason: string | null;
      /** Quantity reduced by staff after this station got the ticket. */
      amendedAt: string | null;
      originalQuantity: number | null;
    }[];
  };
};
/** `timing`: the location's attention times for tickets (Settings → Alerts & timings). */
type Payload = { station: { id: string; name: string }; tickets: Ticket[]; timing?: { notStarted: Threshold; overdue: Threshold; leadMinutes: number } };

/** Same rule as the attention summary: not started (from acceptance, or cooking time of a scheduled pickup), or preparing too long. */
function ticketLevel(tk: Ticket, timing: Payload['timing'], now: number): AttentionLevel {
  if (!timing || tk.status === 'READY' || tk.status === 'CANCELLED') return 'waiting';
  if (tk.status === 'PENDING') return levelFor(now - ticketStartBy(new Date(tk.createdAt), tk.order.pickupAt ? new Date(tk.order.pickupAt) : null, timing.leadMinutes).getTime(), timing.notStarted);
  return levelFor(now - new Date(tk.startedAt ?? tk.createdAt).getTime(), timing.overdue);
}

const POLL_MS = 4000;

const COLUMN = {
  PENDING: { dot: 'bg-info', bar: 'before:bg-info', icon: 'inbox' },
  PREPARING: { dot: 'bg-warning', bar: 'before:bg-warning', icon: 'flame' },
  READY: { dot: 'bg-success', bar: 'before:bg-success', icon: 'checkCircle' },
} as const satisfies Record<Exclude<Ticket['status'], 'CANCELLED'>, { dot: string; bar: string; icon: IconName }>;
const CHANNEL_ICON: Record<Ticket['order']['channel'], IconName> = { TABLE: 'tables', TAKEAWAY: 'bag', DELIVERY: 'truck' };

/**
 * Fullscreen, tablet-friendly kitchen/café display for one station.
 * Always dark (kitchens are bright and screens stay on all day); large type, large buttons,
 * tickets coloured by waiting time.
 */
export function KdsBoard({ org, stationId, stationName, canUpdate, t }: { org: string; stationId: string; stationName: string; canUpdate: boolean; t: Messages['staff'] }) {
  const { data, health, refresh } = usePolling<Payload>(`/api/dashboard/${org}/kds/${stationId}`, POLL_MS);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sound, setSound] = useState(false);
  // iPhone Safari has no Fullscreen API: the button is only offered where it actually works.
  const [canFullscreen, setCanFullscreen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const seen = useRef<Set<string> | null>(null);
  // An attention link (?focus=ticket-…) scrolls to that ticket and marks it.
  useScrollToFocus(useFocusParam(), !!data);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 10000);
    setCanFullscreen(!!document.fullscreenEnabled && typeof document.documentElement.requestFullscreen === 'function');
    const onFs = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFs);
    return () => {
      clearInterval(t);
      document.removeEventListener('fullscreenchange', onFs);
    };
  }, []);

  useEffect(() => {
    if (!data) return;
    // A new ticket, and a change staff made to a ticket already on screen, both chime.
    const keys = new Set(
      data.tickets.flatMap((t) => [
        ...(t.status === 'PENDING' || t.status === 'CANCELLED' ? [`${t.status}:${t.id}`] : []),
        ...t.order.items.filter((i) => i.voidedAt || i.amendedAt).map((i) => `change:${i.id}:${i.voidedAt ?? i.amendedAt}`),
      ]),
    );
    if (seen.current && sound && [...keys].some((k) => !seen.current!.has(k))) playChime();
    seen.current = keys;
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

  if (health.problem)
    return (
      <div className="p-4">
        <PollProblemNotice
          problem={health.problem}
          labels={{ expired: t.sessionExpired, forbidden: t.accessRemoved, notFound: t.stationGone, signIn: t.signInAgain, back: t.allStations }}
          backHref={`/dashboard/${org}/kitchen`}
        />
      </div>
    );
  const tickets = data?.tickets ?? [];
  const columns = [
    // Cancelled tickets lead the first column: stop preparing them.
    { key: 'PENDING', title: t.kdsTodo, empty: t.kdsEmptyTodo, list: [...tickets.filter((t) => t.status === 'CANCELLED'), ...tickets.filter((t) => t.status === 'PENDING')] },
    { key: 'PREPARING', title: t.kdsPreparing, empty: t.emptyPreparing, list: tickets.filter((t) => t.status === 'PREPARING') },
    { key: 'READY', title: t.kdsReady, empty: t.emptyReady, list: tickets.filter((t) => t.status === 'READY') },
  ] as const;

  return (
    <div className="dark min-h-[calc(100dvh-3.5rem)] bg-bg p-3 pb-24 text-ink sm:p-4 sm:pb-24 lg:pb-6" data-testid="kds">
      <header className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <Link
          href={`/dashboard/${org}/kitchen`}
          className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-line bg-surface text-ink-2 hover:bg-surface-2 hover:text-ink pointer-coarse:size-11"
          aria-label={t.allStations}
          title={t.allStations}
        >
          <Icon name="chevronLeft" className="rtl:rotate-180" />
        </Link>
        <h1 className="min-w-0 text-xl font-semibold tracking-tight sm:text-2xl">{data?.station.name ?? stationName}</h1>
        <ConnectionBadge health={health} labels={{ live: t.live, lost: t.connectionLost, reconnecting: t.reconnecting, connecting: t.connecting, lastUpdate: t.lastUpdate }} />
        <div className="ms-auto flex flex-wrap gap-2">
          <Button
            size="sm"
            variant={sound ? 'secondary' : 'ghost'}
            icon={sound ? 'volume' : 'volumeOff'}
            aria-pressed={sound}
            onClick={() => {
              setSound(!sound);
              if (!sound) playChime();
            }}
          >
            {sound ? t.soundOn : t.enableSound}
          </Button>
          {canFullscreen && (
            <Button
              size="sm"
              variant="ghost"
              icon="maximize"
              onClick={() => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => undefined)}
              data-testid="kds-fullscreen"
            >
              {isFullscreen ? t.exitFullscreen : t.fullscreen}
            </Button>
          )}
        </div>
      </header>
      {/* Since when the tickets below have not been updated, while the connection is down. */}
      <div className="mb-3 empty:hidden">
        <StaleBanner health={health} text={t.staleBoard} />
      </div>
      {error && (
        <div className="mb-3">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}
      {!data && (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3" role="status" aria-busy="true">
          <span className="sr-only">{t.loading}</span>
          {[0, 1, 2].map((i) => (
            <div key={i} className={cn('space-y-3 rounded-2xl bg-surface/60 p-3', i === 1 && 'hidden md:block', i === 2 && 'hidden lg:block')}>
              <div className="h-4 w-24 animate-pulse rounded bg-surface-3" />
              <div className="h-44 animate-pulse rounded-xl bg-surface-2" />
            </div>
          ))}
        </div>
      )}
      <div className={cn('grid items-start gap-3 md:grid-cols-2 lg:grid-cols-3', !data && 'hidden')}>
        {columns.map((col) => (
          <section
            key={col.key}
            data-testid={`kds-${col.key}`}
            className={cn('relative overflow-hidden rounded-2xl border border-line bg-surface/60 p-2.5 before:absolute before:inset-x-0 before:top-0 before:h-0.5', COLUMN[col.key].bar)}
          >
            <h2 className="mb-2.5 flex items-center gap-2 px-1 pt-1 text-sm font-semibold text-ink-2">
              <span className={cn('size-2 rounded-full', COLUMN[col.key].dot)} aria-hidden />
              {col.title}
              <span className="ms-auto rounded-md bg-surface-3 px-1.5 py-0.5 text-xs text-ink tabular-nums">{col.list.length}</span>
            </h2>
            {col.list.length === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-line px-4 py-10 text-center text-sm text-muted">
                <Icon name={COLUMN[col.key].icon} className="size-6 opacity-60" />
                {col.empty}
              </div>
            ) : (
              <div className="space-y-2.5">
                {col.list.map((tk) => {
                  const from = tk.order.acceptedAt ?? tk.createdAt;
                  const cancelled = tk.status === 'CANCELLED';
                  const level = ticketLevel(tk, data?.timing, now);
                  const late = level === 'urgent';
                  const slow = level === 'warning';
                  return (
                    <article
                      key={tk.id}
                      id={`ticket-${tk.id}`}
                      data-level={level}
                      className={cn(
                        'animate-fade-in scroll-mt-24 rounded-xl border-2 bg-surface-2 p-3.5 sm:p-4 data-[focused=true]:ring-4 data-[focused=true]:ring-warning/70',
                        cancelled ? 'border-danger border-dashed opacity-80' : tk.status === 'READY' ? 'border-success/60' : late ? 'border-danger' : slow ? 'border-warning' : tk.order.isPriority ? 'border-danger/60' : 'border-line',
                      )}
                      data-testid="kds-ticket"
                      data-status={tk.status}
                    >
                      {cancelled && (
                        <p className="mb-2 flex items-center gap-2 rounded-lg bg-danger px-2.5 py-1.5 text-base font-bold text-graphite" data-testid="kds-ticket-cancelled">
                          <Icon name="alert" className="size-4 shrink-0" />
                          {t.kdsTicketCancelled}
                        </p>
                      )}
                      <header className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="flex flex-wrap items-center gap-2 text-2xl font-bold tabular-nums">
                            #{tk.order.number}
                            {tk.order.isPriority && (
                              <span className="inline-flex items-center gap-1 rounded-md bg-danger px-2 py-0.5 text-sm font-semibold text-graphite" data-testid="kds-priority">
                                <Icon name="zap" className="size-3.5" />
                                {t.priority}
                              </span>
                            )}
                          </p>
                          <p className="mt-0.5 flex items-center gap-1.5 text-base text-ink-2 sm:text-lg">
                            <Icon name={CHANNEL_ICON[tk.order.channel]} className="size-4 text-muted" />
                            <span className="min-w-0 break-words">
                              {tk.order.channel === 'TABLE' ? f(t.table, { label: tk.order.table?.label ?? '?' }) : tk.order.channel === 'TAKEAWAY' ? `${t.takeaway} ${tk.order.customerName ?? ''}` : t.delivery}
                            </span>
                          </p>
                        </div>
                        <p
                          className={cn(
                            'inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-base font-semibold tabular-nums sm:text-lg',
                            tk.status === 'READY' ? 'bg-success/15 text-success' : late ? 'bg-danger text-graphite' : slow ? 'bg-warning text-graphite' : 'bg-surface-3 text-ink',
                          )}
                        >
                          <Icon name="clock" className="size-4" />
                          {elapsed(from, now)}
                        </p>
                      </header>
                      <ul className="mt-3 space-y-2 border-t border-line pt-3 text-lg leading-snug">
                        {tk.order.items.map((i) => (
                          <li key={i.id} className={cn(i.voidedAt && 'text-muted')} data-testid={i.voidedAt ? 'kds-item-removed' : i.amendedAt ? 'kds-item-changed' : undefined}>
                            {/* Changes made by staff after the ticket arrived stay visible on it. */}
                            {i.voidedAt && (
                              <span className="mb-0.5 flex items-start gap-1.5 text-base font-bold text-danger">
                                <Icon name="alert" className="mt-1 size-4 shrink-0" />
                                <span className="min-w-0">
                                  {t.kdsItemRemoved}
                                  {i.voidReason && <span className="block font-normal wrap-anywhere">{i.voidReason}</span>}
                                </span>
                              </span>
                            )}
                            {i.amendedAt && !i.voidedAt && i.originalQuantity !== null && (
                              <span className="mb-0.5 flex items-center gap-1.5 text-base font-bold text-warning">
                                <Icon name="alert" className="size-4 shrink-0" />
                                {f(t.kdsItemChanged, { n: i.originalQuantity })}
                              </span>
                            )}
                            <span className={cn('me-1 inline-block min-w-7 font-bold tabular-nums', i.voidedAt ? 'line-through' : 'text-accent')}>{i.quantity}×</span>
                            <span className={cn(i.voidedAt && 'line-through')}>{i.nameSnapshot}</span>
                            {i.variantNameSnapshot && <span className="text-muted"> · {i.variantNameSnapshot}</span>}
                            {i.modifiers.length > 0 && <span className="block ps-8 text-base text-ink-2">{i.modifiers.map((x) => `${x.quantity > 1 ? `${x.quantity}× ` : ''}${x.nameSnapshot}`).join(', ')}</span>}
                            {i.notes && (
                              <span className="mt-0.5 flex items-start gap-1.5 ps-8 text-base font-semibold wrap-anywhere text-warning">
                                <Icon name="alert" className="mt-1 size-4 shrink-0" />
                                {i.notes}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                      {tk.order.customerNotes && (
                        <p className="mt-3 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-2.5 py-1.5 text-base wrap-anywhere text-warning">
                          <Icon name="info" className="mt-1 size-4 shrink-0" />
                          {tk.order.customerNotes}
                        </p>
                      )}
                      {canUpdate && !cancelled && (
                        <div className="mt-4 flex gap-2">
                          {tk.status === 'PENDING' && (
                            <Button size="lg" className="flex-1" icon="flame" loading={busy === tk.id} disabled={busy === tk.id} onClick={() => move(tk, 'PREPARING')} data-testid="kds-start">
                              {t.kdsStart}
                            </Button>
                          )}
                          {tk.status !== 'READY' && (
                            <Button size="lg" variant={tk.status === 'PENDING' ? 'secondary' : 'primary'} className="flex-1" icon="check" loading={busy === tk.id && tk.status === 'PREPARING'} disabled={busy === tk.id} onClick={() => move(tk, 'READY')} data-testid="kds-ready">
                              {t.kdsReadyBtn}
                            </Button>
                          )}
                          {tk.status === 'READY' && (
                            <Button size="lg" variant="secondary" className="flex-1" icon="refresh" disabled={busy === tk.id} onClick={() => move(tk, 'PREPARING')}>
                              {t.kdsUndo}
                            </Button>
                          )}
                          <a
                            href={`/api/dashboard/${org}/kds/tickets/${tk.id}/pdf`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex size-12 shrink-0 items-center justify-center rounded-lg border border-line bg-surface text-ink-2 hover:bg-surface-3 hover:text-ink"
                            data-testid="kds-print"
                            aria-label={t.kdsPrint}
                            title={t.kdsPrint}
                          >
                            <Icon name="print" className="size-5" />
                          </a>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
