import type { ReactNode } from 'react';
import { LogoMark } from '@/components/brand/logo';
import { Icon, type IconName } from '@/components/ui/icons';
import { cn } from '@/lib/cn';

/*
 * Coded product illustrations for the landing page. They mirror real MenuNiva screens (guest menu,
 * order tracking, live orders) with sample dishes from "Restaurante Demo". Decorative: callers wrap
 * them in aria-hidden, and they contain no real controls. One sample order (#1042, Table 12) runs
 * through the page: ordered in the hero, prepared in "Every order", split by station in the kitchen.
 */

// ------------------------------------------------------------------ frames

export function BrowserFrame({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_50px_100px_-30px_rgb(16_18_20/0.32),0_20px_40px_-20px_rgb(16_18_20/0.18)] dark:shadow-[0_50px_100px_-30px_rgb(0_0_0/0.85)]',
        className,
      )}
    >
      <div className="flex h-9 items-center gap-3 border-b border-line bg-surface-2 px-3.5">
        <span className="flex shrink-0 gap-1.5">
          <span className="size-2.5 rounded-full bg-[#ff5f57]" />
          <span className="size-2.5 rounded-full bg-[#febc2e]" />
          <span className="size-2.5 rounded-full bg-[#28c840]" />
        </span>
        <span className="mx-auto flex h-6 min-w-0 items-center gap-1.5 rounded-md bg-surface px-3 text-[11px] text-muted ring-1 ring-line">
          <Icon name="lock" className="size-3" />
          <span className="truncate">{title}</span>
        </span>
        <span className="w-[46px] shrink-0" />
      </div>
      {children}
    </div>
  );
}

export function PhoneFrame({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('relative rounded-[2.6rem] bg-[#0e0f11] p-2.5 shadow-[0_40px_80px_-24px_rgb(16_18_20/0.5),inset_0_0_0_1px_rgb(255_255_255/0.1)]', className)}>
      <span className="absolute top-24 -start-[3px] h-10 w-[3px] rounded-s-sm bg-[#0e0f11]" />
      <span className="absolute top-28 -end-[3px] h-14 w-[3px] rounded-e-sm bg-[#0e0f11]" />
      <div className="relative aspect-[9/19.5] overflow-hidden rounded-[2.05rem] bg-sf-bg">
        <span className="absolute inset-x-0 top-2.5 z-20 mx-auto h-[22px] w-[30%] rounded-full bg-black" />
        {children}
      </div>
    </div>
  );
}

function StatusBar() {
  return (
    <div className="relative z-10 flex h-11 shrink-0 items-end justify-between px-6 pb-1 text-[11px] font-semibold">
      <span>12:30</span>
      <span className="flex items-center gap-1">
        <svg viewBox="0 0 18 12" className="h-2.5 w-4" fill="currentColor">
          <rect x="0" y="8" width="3" height="4" rx="1" />
          <rect x="5" y="5" width="3" height="7" rx="1" />
          <rect x="10" y="2.5" width="3" height="9.5" rx="1" />
          <rect x="15" y="0" width="3" height="12" rx="1" />
        </svg>
        <svg viewBox="0 0 26 12" className="h-2.5 w-5">
          <rect x="0.5" y="0.5" width="22" height="11" rx="3" fill="none" stroke="currentColor" opacity=".4" />
          <rect x="2" y="2" width="16" height="8" rx="1.8" fill="currentColor" />
          <rect x="24" y="4" width="1.5" height="4" rx=".75" fill="currentColor" opacity=".4" />
        </svg>
      </span>
    </div>
  );
}

// ------------------------------------------------------------------ dish art

export type DishKind = 'tagine' | 'couscous' | 'tea' | 'nata';

/** Top-down illustrations standing in for dish photos. */
const ART: Record<DishKind, ReactNode> = {
  tagine: (
    <>
      <rect width="64" height="64" fill="#f3e3cc" />
      <circle cx="32" cy="34" r="24" fill="#e7cfae" stroke="#d8b98f" strokeWidth="1.5" />
      <circle cx="32" cy="34" r="18" fill="#c4643a" />
      <circle cx="32" cy="34" r="13" fill="#d47b48" />
      <circle cx="32" cy="34" r="7.5" fill="#b4562f" />
      <circle cx="32" cy="34" r="3.2" fill="#8a3d1d" />
      <circle cx="13" cy="21" r="4.2" fill="#f2cf5b" />
      <circle cx="13" cy="21" r="2.3" fill="#f8e392" />
      <circle cx="50" cy="48" r="2.6" fill="#5d6b2d" />
      <circle cx="45.5" cy="52" r="2.2" fill="#6f7f35" />
    </>
  ),
  couscous: (
    <>
      <rect width="64" height="64" fill="#f1ead9" />
      <circle cx="32" cy="32" r="25" fill="#ffffff" stroke="#e6dcc6" strokeWidth="1.5" />
      <circle cx="32" cy="32" r="19" fill="#e9c47a" />
      <circle cx="25" cy="26" r="3.6" fill="#e2783b" />
      <circle cx="39" cy="38" r="3.6" fill="#e2783b" />
      <circle cx="37" cy="24" r="3.2" fill="#7da857" />
      <circle cx="24" cy="38" r="3.2" fill="#7da857" />
      <circle cx="32" cy="32" r="2.6" fill="#cfa25a" />
      <circle cx="31" cy="42" r="2.4" fill="#cfa25a" />
      <circle cx="42" cy="30" r="2.4" fill="#c4473a" />
    </>
  ),
  tea: (
    <>
      <rect width="64" height="64" fill="#e6efdc" />
      <circle cx="30" cy="35" r="21" fill="#d5e3c6" />
      <circle cx="30" cy="35" r="14" fill="#f6f1e6" />
      <circle cx="30" cy="35" r="11.5" fill="#c8892c" />
      <circle cx="26.5" cy="31.5" r="3" fill="#e2b15a" opacity=".85" />
      <path d="M38 16c6-5 13-4 15-1-3 5-9 7-15 1z" fill="#5c9a3b" />
      <path d="M43 22c5-1 10 2 10 5-5 2-9 0-10-5z" fill="#6fae4a" />
    </>
  ),
  nata: (
    <>
      <rect width="64" height="64" fill="#f4e6cf" />
      <circle cx="32" cy="32" r="22" fill="#d9a352" />
      <circle cx="32" cy="32" r="17" fill="#f1c768" />
      <circle cx="27" cy="28" r="4" fill="#a8621f" opacity=".75" />
      <circle cx="37" cy="35" r="3" fill="#a8621f" opacity=".6" />
      <circle cx="33" cy="25" r="2" fill="#8f4f17" opacity=".6" />
      <circle cx="26" cy="37" r="2.4" fill="#8f4f17" opacity=".5" />
    </>
  ),
};

export function DishArt({ kind, className }: { kind: DishKind; className?: string }) {
  return (
    <span className={cn('block shrink-0 overflow-hidden', className)}>
      <svg viewBox="0 0 64 64" className="block size-full">
        {ART[kind]}
      </svg>
    </span>
  );
}

// ------------------------------------------------------------------ guest phone screens

function MockDish({ name, desc, price, art, badge }: { name: string; desc: string; price: string; art: DishKind; badge?: { icon?: IconName; label: string } }) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl bg-sf-card p-2 shadow-[0_1px_2px_rgb(0_0_0/0.05)] ring-1 ring-sf-text/[0.06]">
      <div className="min-w-0 flex-1">
        {badge && (
          <span className="mb-1 inline-flex items-center gap-0.5 rounded-full bg-sf-accent/15 px-1.5 py-px text-[10px] font-semibold">
            {badge.icon && <Icon name={badge.icon} className="size-2.5" />}
            {badge.label}
          </span>
        )}
        <p className="truncate text-[12px] leading-tight font-semibold">{name}</p>
        <p className="truncate text-[11px] opacity-60">{desc}</p>
        <p className="mt-1 text-[12px] font-bold text-sf-primary-ink tabular-nums">{price}</p>
      </div>
      <div className="relative shrink-0">
        <DishArt kind={art} className="size-14 rounded-lg" />
        <span className="absolute -end-1 -bottom-1 flex size-6 items-center justify-center rounded-full bg-sf-primary text-sf-on-primary ring-2 ring-sf-card">
          <Icon name="plus" className="size-3.5" strokeWidth={2.4} />
        </span>
      </div>
    </div>
  );
}

/** Guest menu at Table 12 (storefront default theme). */
export function GuestMenuScreen() {
  return (
    <div className="flex h-full flex-col text-sf-text">
      <StatusBar />
      {/* Fixed blocks never shrink; only the dish list is clipped when the phone is short. */}
      <div className="relative mx-2.5 mt-1 shrink-0 overflow-hidden rounded-2xl bg-sf-primary px-3.5 pt-3.5 pb-3 text-sf-on-primary">
        <div className="sf-pattern absolute inset-0 opacity-60" />
        <div className="relative">
          <div className="flex items-center gap-2">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25">
              <Icon name="kitchen" className="size-4" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-[13px] leading-tight font-semibold">Restaurante Demo</p>
              <p className="truncate text-[11px] opacity-80">Table 12 · Main room</p>
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between gap-1">
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-medium">
              <span className="size-1.5 rounded-full bg-[#7ee08a]" />
              Open now
            </span>
            <span className="flex min-w-0 gap-0.5 rounded-full bg-black/20 p-0.5 text-[10px] font-semibold">
              {['PT', 'EN', 'FR', 'ع', 'ES'].map((l) => (
                <span key={l} className={cn('rounded-full px-1.5 py-px', l === 'EN' ? 'bg-white text-sf-primary' : 'opacity-80')}>
                  {l}
                </span>
              ))}
            </span>
          </div>
        </div>
      </div>
      <div className="mt-3 flex shrink-0 gap-1.5 overflow-hidden px-2.5 text-[11px] font-medium whitespace-nowrap">
        {['Popular', 'Mains', 'Tea & drinks', 'Desserts'].map((c, i) => (
          <span key={c} className={cn('rounded-full px-2.5 py-1', i === 0 ? 'bg-sf-text text-sf-bg' : 'bg-sf-text/[0.06]')}>
            {c}
          </span>
        ))}
      </div>
      <div className="mt-2.5 min-h-0 flex-1 space-y-2 overflow-hidden px-2.5">
        <MockDish name="Chicken tagine with lemon" desc="Preserved lemon, olives, saffron" price="€14.50" art="tagine" badge={{ icon: 'star', label: 'Popular' }} />
        <MockDish name="Vegetable couscous" desc="Seven vegetables, chickpeas" price="€12.00" art="couscous" badge={{ label: 'Vegan' }} />
        <MockDish name="Mint tea for two" desc="Fresh mint, served hot" price="€4.50" art="tea" />
        <MockDish name="Pastel de nata" desc="Warm, with cinnamon" price="€1.80" art="nata" />
      </div>
      <div className="shrink-0 p-2.5 pb-4">
        <div className="flex items-center justify-between rounded-2xl bg-sf-primary px-3.5 py-2.5 text-sf-on-primary shadow-lg">
          <span className="flex items-center gap-2 text-[12px] font-semibold">
            <span className="flex size-5 items-center justify-center rounded-full bg-white/20 text-[11px]">3</span>
            View order
          </span>
          <span className="text-[12px] font-bold tabular-nums">€31.00</span>
        </div>
      </div>
    </div>
  );
}

/** Guest's private order page after ordering (sample order #1042). */
export function OrderTrackerScreen() {
  const steps: [string, 'done' | 'current' | 'todo'][] = [
    ['Received', 'done'],
    ['Accepted', 'done'],
    ['Preparing', 'current'],
    ['Ready', 'todo'],
  ];
  const lines: [string, string][] = [
    ['1× Chicken tagine with lemon', '€14.50'],
    ['1× Vegetable couscous', '€12.00'],
    ['1× Mint tea for two', '€4.50'],
  ];
  return (
    <div className="flex h-full flex-col text-sf-text">
      <StatusBar />
      <div className="px-4 pt-2">
        <p className="text-[11px] font-medium opacity-60">Restaurante Demo · Table 12</p>
        <p className="mt-0.5 text-[17px] leading-tight font-semibold">Order #1042</p>
      </div>
      <div className="mx-3 mt-3 rounded-2xl bg-sf-primary p-3.5 text-sf-on-primary">
        <div className="flex items-center gap-2.5">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-white/15">
            <Icon name="flame" className="size-[18px]" />
          </span>
          <div className="min-w-0">
            <p className="text-[14px] leading-tight font-semibold">Being prepared</p>
            <p className="truncate text-[11px] opacity-75">Accepted at 12:31</p>
          </div>
        </div>
        <div className="mt-3.5 grid grid-cols-4 gap-1">
          {steps.map(([label, s]) => (
            <div key={label} className="min-w-0">
              <span className={cn('block h-1 rounded-full', s === 'done' ? 'bg-white' : s === 'current' ? 'bg-white/60' : 'bg-white/20')} />
              <span className={cn('mt-1 block truncate text-[10px]', s === 'todo' ? 'opacity-50' : 'opacity-90')}>{label}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="mx-3 mt-3 rounded-2xl bg-sf-card p-3 ring-1 ring-sf-text/[0.06]">
        <ul className="space-y-1.5 text-[11px]">
          {lines.map(([item, price]) => (
            <li key={item} className="flex justify-between gap-2">
              <span className="truncate">{item}</span>
              <span className="shrink-0 tabular-nums opacity-70">{price}</span>
            </li>
          ))}
        </ul>
        <div className="mt-2.5 flex justify-between border-t border-sf-text/10 pt-2 text-[12px] font-semibold">
          <span>Total</span>
          <span className="tabular-nums">€31.00</span>
        </div>
      </div>
      <div className="mx-3 mt-3 grid grid-cols-2 gap-2">
        {(
          [
            ['bell', 'Call waiter'],
            ['bill', 'Ask for the bill'],
          ] as [IconName, string][]
        ).map(([icon, label]) => (
          <span key={label} className="flex h-10 items-center justify-center gap-1.5 rounded-xl bg-sf-card text-[11px] font-semibold ring-1 ring-sf-text/10">
            <Icon name={icon} className="size-3.5" />
            {label}
          </span>
        ))}
      </div>
      {/* Voluntary loyalty enrolment, offered on the order page. */}
      <div className="mx-3 mt-3 rounded-2xl border border-dashed border-sf-accent/60 bg-sf-accent/10 p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[12px] font-semibold">Collect stamps</p>
          <span className="text-[10px] opacity-60">Optional</span>
        </div>
        <div className="mt-2 flex gap-1">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <span key={i} className={cn('size-4 rounded-full', i === 0 ? 'bg-sf-primary' : 'border border-dashed border-sf-text/25')} />
          ))}
        </div>
        <p className="mt-2 text-[10px] opacity-70">Join with your phone number. 6 stamps for a free mint tea.</p>
      </div>
      <p className="mt-auto pb-6 text-center text-[11px] opacity-60">Pay at the table or at the counter</p>
    </div>
  );
}

// ------------------------------------------------------------------ live orders board

type MockOrder = {
  where: string;
  id: string;
  mins: number;
  items: [number, string][];
  note?: string;
  stations?: { name: string; done: boolean }[];
  action?: { label: string; primary?: boolean };
};

function OrderCardMock({ o }: { o: MockOrder }) {
  // Same colour rule as the real board: amber after 10 minutes, red after 20.
  const age = o.mins > 20 ? 'bg-danger/10 text-danger' : o.mins > 10 ? 'bg-warning/10 text-warning' : 'bg-surface-2 text-ink-2';
  return (
    <div className="rounded-lg border border-line bg-surface p-2.5 shadow-xs">
      <div className="flex items-center justify-between gap-1">
        <p className="truncate text-[12px] font-semibold text-ink">{o.where}</p>
        <span className={cn('shrink-0 rounded px-1 text-[11px] tabular-nums', age)}>{o.mins} min</span>
      </div>
      <p className="text-[11px] text-muted">#{o.id}</p>
      <ul className="mt-1.5 space-y-0.5 text-[11px] text-ink-2">
        {o.items.map(([q, n]) => (
          <li key={n} className="truncate">
            <span className="font-semibold text-ink">{q}×</span> {n}
          </li>
        ))}
      </ul>
      {o.note && <p className="mt-1 truncate text-[11px] text-muted">{o.note}</p>}
      {o.stations && (
        <div className="mt-2 flex flex-wrap gap-1">
          {o.stations.map((s) => (
            <span
              key={s.name}
              className={cn('inline-flex items-center gap-0.5 rounded border px-1 text-[10px] font-medium', s.done ? 'border-success/20 bg-success/10 text-success' : 'border-line bg-surface-2 text-muted')}
            >
              {s.done && <Icon name="check" className="size-2.5" strokeWidth={2.4} />}
              {s.name}
            </span>
          ))}
        </div>
      )}
      {o.action && (
        <span className={cn('mt-2 flex h-7 items-center justify-center rounded-md text-[11px] font-semibold', o.action.primary ? 'bg-lime text-lime-ink' : 'border border-line bg-surface text-ink')}>
          {o.action.label}
        </span>
      )}
    </div>
  );
}

const BOARD: { title: string; dot: string; className?: string; orders: MockOrder[] }[] = [
  {
    title: 'New',
    dot: 'bg-lime',
    orders: [
      { where: 'Table 12', id: '1042', mins: 1, items: [[1, 'Chicken tagine'], [1, 'Vegetable couscous'], [1, 'Mint tea for two']], action: { label: 'Accept', primary: true } },
      { where: 'Takeaway · Ana', id: '1043', mins: 2, items: [[2, 'Falafel wrap']], note: 'Pickup at 13:15', action: { label: 'Accept', primary: true } },
    ],
  },
  {
    title: 'Accepted',
    dot: 'bg-info',
    orders: [{ where: 'Delivery · 4700-123', id: '1039', mins: 6, items: [[1, 'Lamb couscous'], [2, 'Harira soup']], action: { label: 'Start preparing' } }],
  },
  {
    title: 'Preparing',
    dot: 'bg-warning',
    className: 'hidden @xl:block',
    orders: [
      {
        where: 'Table 4',
        id: '1036',
        mins: 12,
        items: [[3, 'Vegetable couscous'], [1, 'Orange juice']],
        stations: [
          { name: 'Kitchen', done: false },
          { name: 'Café', done: true },
        ],
        action: { label: 'Mark ready' },
      },
      { where: 'Table 9', id: '1035', mins: 14, items: [[2, 'Grilled sea bass']], stations: [{ name: 'Kitchen', done: false }] },
    ],
  },
  {
    title: 'Ready',
    dot: 'bg-success',
    className: 'hidden @3xl:block',
    orders: [
      {
        where: 'Table 7',
        id: '1031',
        mins: 18,
        items: [[2, 'Pastel de nata'], [2, 'Coffee']],
        stations: [
          { name: 'Kitchen', done: true },
          { name: 'Café', done: true },
        ],
        action: { label: 'Complete' },
      },
    ],
  },
];

const SIDEBAR: IconName[] = ['home', 'orders', 'kitchen', 'tables', 'bill', 'calendar', 'chart', 'settings'];

/** The staff live orders board (dashboard theme). Adapts to its own width with container queries. */
export function LiveBoardMock() {
  return (
    <div className="@container flex min-h-[480px] bg-bg text-ink lg:min-h-[540px] xl:min-h-[580px]">
      <div className="hidden w-14 shrink-0 flex-col items-center gap-1.5 border-e border-line bg-surface py-3 @2xl:flex">
        <LogoMark className="mb-2 size-7" title="" />
        {SIDEBAR.map((name, i) => (
          <span key={name} className={cn('flex size-9 items-center justify-center rounded-lg text-muted', i === 1 && 'bg-surface-2 text-ink ring-1 ring-line')}>
            <Icon name={name} />
          </span>
        ))}
      </div>
      <div className="min-w-0 flex-1 p-4 lg:p-5">
        <div className="flex items-center gap-2">
          <p className="text-[15px] font-semibold">Live orders</p>
          <span className="inline-flex items-center gap-1 rounded-md border border-success/20 bg-success/10 px-1.5 text-[11px] font-medium text-success">
            <span className="relative inline-flex size-1.5">
              <span className="absolute inset-0 animate-ping rounded-full bg-success opacity-60" />
              <span className="relative size-1.5 rounded-full bg-success" />
            </span>
            Live
          </span>
          <span className="ms-auto inline-flex h-7 items-center gap-1 rounded-lg border border-line bg-surface px-2 text-[11px] text-ink-2">
            Main room <Icon name="chevronDown" className="size-3" />
          </span>
        </div>
        <div className="mt-3 flex items-center gap-2.5 rounded-xl border border-lime/60 bg-accent-soft px-3 py-2">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-lime text-lime-ink">
            <Icon name="bell" className="size-3.5" />
          </span>
          <p className="min-w-0 flex-1 truncate text-[12px] font-semibold">2 new orders waiting</p>
          <span className="rounded-md bg-graphite px-2 py-1 text-[11px] font-medium text-white dark:bg-white dark:text-graphite">Show</span>
        </div>
        <div className="mt-3 grid grid-cols-2 items-start gap-2.5 @xl:grid-cols-3 @3xl:grid-cols-4">
          {BOARD.map((col) => (
            <div key={col.title} className={cn('rounded-xl border border-line bg-surface-2/60 p-2', col.className)}>
              <p className="mb-2 flex items-center gap-1.5 px-0.5 text-[12px] font-semibold text-ink">
                <span className={cn('size-2 rounded-full', col.dot)} />
                {col.title}
                <span className={cn('ms-auto min-w-5 rounded-md px-1 text-center text-[11px] tabular-nums', col.title === 'New' ? 'bg-lime text-lime-ink' : 'bg-black/5 dark:bg-white/10')}>
                  {col.orders.length}
                </span>
              </p>
              <div className="space-y-2">
                {col.orders.map((o) => (
                  <OrderCardMock key={o.id} o={o} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ floating cards

export function OrderToast({ className }: { className?: string }) {
  return (
    <div className={cn('flex w-max items-center gap-3 rounded-2xl border border-line bg-surface/95 p-2.5 pe-4 text-start shadow-lg backdrop-blur', className)}>
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-lime text-lime-ink">
        <Icon name="bell" className="size-4" />
      </span>
      <div>
        <p className="text-[13px] leading-tight font-semibold text-ink">New order · Table 12</p>
        <p className="mt-0.5 text-xs text-muted">3 items · €31.00</p>
      </div>
    </div>
  );
}

export function StationTicketFloat({ className }: { className?: string }) {
  return (
    <div className={cn('w-56 overflow-hidden rounded-2xl bg-[#141619] text-start text-white shadow-2xl ring-1 ring-white/10', className)}>
      <div className="flex items-center justify-between bg-white/[0.05] px-3.5 py-2.5">
        <span className="flex items-center gap-1.5 text-[12px] font-semibold">
          <Icon name="station" className="size-3.5 text-lime" />
          Café
        </span>
        <span className="text-[11px] text-white/50 tabular-nums">Table 12 · #1042</span>
      </div>
      <p className="px-3.5 py-3 text-[13px]">
        <span className="font-semibold text-lime">1×</span> Mint tea for two
      </p>
      <p className="flex items-center gap-1.5 border-t border-white/10 px-3.5 py-2.5 text-[12px] text-[#52c983]">
        <Icon name="checkCircle" className="size-4" />
        Ready · waiting for kitchen
      </p>
    </div>
  );
}

export function WaiterCalledToast({ className }: { className?: string }) {
  return (
    <div className={cn('flex w-max items-center gap-3 rounded-2xl border border-line bg-surface/95 p-2.5 pe-4 text-start shadow-lg backdrop-blur', className)}>
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-graphite text-lime dark:bg-white/10">
        <Icon name="users" className="size-4" />
      </span>
      <div>
        <p className="text-[13px] leading-tight font-semibold text-ink">Waiter called</p>
        <p className="mt-0.5 text-xs text-muted">Table 12 · Main room · now</p>
      </div>
    </div>
  );
}
