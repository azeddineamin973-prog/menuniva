'use client';

import Link from 'next/link';
import { useCallback, useSyncExternalStore } from 'react';
import { Icon } from '@/components/ui/icons';
import { Menu, type MenuItem } from '@/components/ui/menu';
import { cn } from '@/lib/cn';
import { attentionText, fillText as fill, type AttentionItem, type AttentionLevel, type AttentionSummary } from '@/lib/attention';
import type { Messages } from '@/i18n';
import { elapsed } from './use-polling';

/**
 * The shared attention summary shown at the top of every dashboard page (audit OPS-01, D4). The
 * items come from the server (one computation for every device); this only presents them: the
 * most urgent first, each a direct link to the order, ticket, request or booking. Hiding the bar
 * changes this device's view only and never resolves anything; a new or more urgent item shows it
 * again. No sound here (alert sounds are a separate task).
 */
export type AttentionLabels = Messages['shell']['attention'];

/** How long it has been open now: the server's age plus the time since that answer arrived. */
export const attentionAge = (i: AttentionItem, sinceAnswerMs: number) => {
  const now = Date.now();
  return elapsed(new Date(now - i.ageSec * 1000 - Math.max(0, sinceAnswerMs)).toISOString(), now);
};

export const LEVEL_TONE: Record<AttentionLevel, { chip: string; dot: string; bar: string }> = {
  urgent: { chip: 'border-danger/30 bg-danger/10 text-danger', dot: 'bg-danger', bar: 'border-danger/25 bg-danger/8' },
  warning: { chip: 'border-warning/30 bg-warning/10 text-warning', dot: 'bg-warning', bar: 'border-warning/25 bg-warning/8' },
  waiting: { chip: 'border-lime/60 bg-accent-soft text-ink', dot: 'bg-lime', bar: 'border-line bg-surface' },
};

/** Booking, table-request and order pages show the current location: open the item's own location first. */
const LOCATION_PAGES = new Set(['liveOrders', 'tasks', 'reservations']);
function needsSwitch(i: AttentionItem, currentLocationId?: string) {
  return LOCATION_PAGES.has(i.nav) && !!currentLocationId && i.locationId !== currentLocationId;
}
function openInLocation(orgSlug: string, i: AttentionItem) {
  document.cookie = `mn_loc_${orgSlug}=${i.locationId}; path=/; max-age=31536000; samesite=lax`;
  // A full load, so the whole frame (sidebar location, page) follows the new location.
  window.location.assign(i.href);
}

export function attentionMenuItems(a: AttentionSummary, l: AttentionLabels, orgSlug: string, currentLocationId: string | undefined, sinceAnswerMs: number): MenuItem[] {
  return a.items.map((i) => {
    const label = `${i.level === 'urgent' ? `${l.levelUrgent} · ` : i.level === 'warning' ? `${l.levelWarning} · ` : ''}${attentionText(i, l)}${i.locationName ? ` · ${i.locationName}` : ''}`;
    const hint = attentionAge(i, sinceAnswerMs);
    const icon = i.level === 'waiting' ? ('clock' as const) : ('alert' as const);
    return needsSwitch(i, currentLocationId) ? { type: 'button' as const, label, hint, icon, onSelect: () => openInLocation(orgSlug, i) } : { label, href: i.href, hint, icon };
  });
}

// ------------------------------------------------------------------ hide on this device

const HIDDEN_EVENT = 'mn:attention-hidden';
const hiddenKey = (org: string) => `mn_attention_hidden:${org}`;
const subscribe = (cb: () => void) => {
  window.addEventListener('storage', cb);
  window.addEventListener(HIDDEN_EVENT, cb);
  return () => {
    window.removeEventListener('storage', cb);
    window.removeEventListener(HIDDEN_EVENT, cb);
  };
};
/** Items (with their level) that were showing when this device hid the bar. */
function useHidden(org: string) {
  const raw = useSyncExternalStore(
    subscribe,
    () => localStorage.getItem(hiddenKey(org)) ?? '',
    () => '',
  );
  const set = useCallback(
    (keys: string[]) => {
      if (keys.length) localStorage.setItem(hiddenKey(org), keys.join('\n'));
      else localStorage.removeItem(hiddenKey(org));
      window.dispatchEvent(new Event(HIDDEN_EVENT));
    },
    [org],
  );
  return [raw ? new Set(raw.split('\n')) : null, set] as const;
}

export function AttentionBar({ attention, labels, orgSlug, currentLocationId, sinceAnswerMs }: { attention: AttentionSummary | null; labels: AttentionLabels; orgSlug: string; currentLocationId?: string; sinceAnswerMs: number }) {
  const [hidden, setHidden] = useHidden(orgSlug);
  if (!attention || attention.total === 0) return null;
  const top = attention.items[0]?.level ?? 'waiting';
  const late = attention.items.filter((i) => i.level !== 'waiting');
  // Collapsed while everything late was already showing when it was hidden; anything new, or
  // anything that became more urgent, opens it again.
  const collapsed = !!hidden && late.every((i) => hidden.has(`${i.key}:${i.level}`));
  const counts = [
    attention.levels.urgent ? fill(labels.urgent, { n: attention.levels.urgent }) : null,
    attention.levels.warning ? fill(labels.warning, { n: attention.levels.warning }) : null,
    attention.levels.waiting ? fill(labels.waiting, { n: attention.levels.waiting }) : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const tone = LEVEL_TONE[top];
  const chips = (late.length ? late : attention.items).slice(0, 3);
  return (
    <div
      className={cn('flex min-w-0 items-center gap-2 border-b px-3 py-1.5 sm:px-4 lg:px-8 print:hidden', tone.bar)}
      role="region"
      aria-label={labels.title}
      data-testid="attention-bar"
      data-level={top}
      data-collapsed={collapsed ? 'true' : undefined}
    >
      <span className={cn('size-2 shrink-0 rounded-full', tone.dot, top !== 'waiting' && 'animate-pulse')} aria-hidden />
      <span className="shrink-0 text-[13px] font-semibold text-ink">{labels.title}</span>
      <span className={cn('shrink-0 text-xs text-ink-2 tabular-nums', !collapsed && 'hidden sm:inline')} data-testid="attention-counts">
        {counts}
      </span>
      {collapsed ? (
        <button type="button" onClick={() => setHidden([])} className="ms-auto inline-flex min-h-8 shrink-0 items-center rounded-md px-2 text-xs font-medium text-ink-2 hover:bg-surface-2 hover:text-ink pointer-coarse:min-h-10" title={labels.hiddenHint} data-testid="attention-show">
          {labels.show}
        </button>
      ) : (
        <>
          <ul className="mn-scroll flex min-w-0 flex-1 gap-1.5 overflow-x-auto py-0.5">
            {chips.map((i) => (
              <li key={i.key} className="shrink-0">
                <Link
                  href={i.href}
                  onClick={(e) => {
                    if (!needsSwitch(i, currentLocationId)) return;
                    e.preventDefault();
                    openInLocation(orgSlug, i);
                  }}
                  className={cn('inline-flex min-h-8 items-center gap-1.5 rounded-lg border px-2 text-xs font-medium whitespace-nowrap hover:brightness-95 pointer-coarse:min-h-10', LEVEL_TONE[i.level].chip)}
                  data-testid="attention-item"
                  data-kind={i.kind}
                  data-level={i.level}
                  data-ref={i.entityId}
                >
                  {i.level !== 'waiting' && <Icon name="alert" className="size-3.5 shrink-0" />}
                  <span>{attentionText(i, labels)}</span>
                  {i.locationName && <span className="opacity-70">· {i.locationName}</span>}
                  {/* The age is read from the clock: it may differ by a second between server and browser. */}
                  <span className="tabular-nums opacity-80" suppressHydrationWarning>
                    · {attentionAge(i, sinceAnswerMs)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {attention.total > chips.length && (
            <Menu
              label={labels.title}
              triggerClassName="inline-flex min-h-8 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-medium text-ink-2 hover:bg-surface-2 hover:text-ink pointer-coarse:min-h-10"
              trigger={
                <>
                  {fill(labels.all, { n: attention.total })}
                  <Icon name="chevronDown" className="size-3.5" />
                </>
              }
              header={<p className="text-sm font-semibold text-ink">{labels.title}</p>}
              items={attentionMenuItems(attention, labels, orgSlug, currentLocationId, sinceAnswerMs)}
              testId="attention-all"
            />
          )}
          <button
            type="button"
            onClick={() => setHidden(late.map((i) => `${i.key}:${i.level}`).concat(late.length ? [] : ['-']))}
            className="inline-flex min-h-8 shrink-0 items-center rounded-md px-2 text-xs font-medium text-muted hover:bg-surface-2 hover:text-ink pointer-coarse:min-h-10"
            title={labels.hiddenHint}
            data-testid="attention-hide"
          >
            {labels.hide}
          </button>
        </>
      )}
    </div>
  );
}
