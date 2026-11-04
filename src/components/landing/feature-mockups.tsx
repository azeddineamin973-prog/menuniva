import type { ReactNode } from 'react';
import { Icon, type IconName } from '@/components/ui/icons';
import { cn } from '@/lib/cn';
import { DishArt, type DishKind } from './mockups';

/*
 * Illustrations for the feature sections, drawn like the real screens with sample data.
 * Decorative: callers wrap them in aria-hidden.
 */

// ------------------------------------------------------------------ import studio

const IMPORT_ROWS: { art: DishKind; name: string; category: string; price: string; state: 'ok' | 'station' | 'price' }[] = [
  { art: 'tagine', name: 'Chicken tagine with lemon', category: 'Mains', price: '€14.50', state: 'ok' },
  { art: 'couscous', name: 'Vegetable couscous', category: 'Mains', price: '€12.00', state: 'ok' },
  { art: 'tea', name: 'Mint tea for two', category: 'Tea & drinks', price: '€4.50', state: 'station' },
  { art: 'nata', name: 'Pastel de nata', category: 'Desserts', price: '—', state: 'price' },
];

const IMPORT_STATE = {
  ok: { label: 'Ready', className: 'border-success/20 bg-success/10 text-success', icon: 'check' },
  station: { label: 'Pick a station', className: 'border-warning/20 bg-warning/10 text-warning', icon: 'station' },
  price: { label: 'Add a price', className: 'border-warning/20 bg-warning/10 text-warning', icon: 'tag' },
} as const satisfies Record<string, { label: string; className: string; icon: IconName }>;

export function ImportMock() {
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_40px_80px_-32px_rgb(16_18_20/0.28)]">
      <div className="flex items-center gap-2.5 border-b border-line px-4 py-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
          <Icon name="import" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink">Import Studio</p>
          <p className="truncate text-xs text-muted">Nothing is published until you confirm</p>
        </div>
      </div>
      <div className="space-y-3.5 p-4">
        <div className="flex flex-wrap gap-1.5">
          {['Glovo link', 'Uber Eats', 'Excel / CSV', 'PDF', 'Text'].map((s, i) => (
            <span key={s} className={cn('rounded-lg border px-2.5 py-1 text-xs font-medium', i === 0 ? 'border-ink bg-ink text-bg' : 'border-line bg-surface text-ink-2')}>
              {s}
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <span className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 text-xs text-muted">
            <Icon name="globe" className="size-3.5 shrink-0" />
            <span className="truncate">glovoapp.com/…/restaurante-demo</span>
          </span>
          <span className="flex h-9 shrink-0 items-center rounded-lg bg-lime px-3 text-xs font-semibold text-lime-ink">Import menu</span>
        </div>
        <div className="overflow-hidden rounded-xl border border-line">
          <div className="flex items-center justify-between gap-2 border-b border-line bg-surface-2/60 px-3 py-2 text-xs">
            <span className="font-semibold text-ink">42 dishes found · 6 categories</span>
            <span className="text-muted">Review</span>
          </div>
          <ul className="divide-y divide-line">
            {IMPORT_ROWS.map((r) => {
              const st = IMPORT_STATE[r.state];
              return (
                <li key={r.name} className="flex items-center gap-2.5 px-3 py-2">
                  <DishArt kind={r.art} className="size-8 rounded-md" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-ink">{r.name}</p>
                    <p className="truncate text-[11px] text-muted">{r.category}</p>
                  </div>
                  <span className="hidden text-xs font-semibold text-ink tabular-nums min-[400px]:block">{r.price}</span>
                  <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-px text-[11px] font-medium', st.className)}>
                    <Icon name={st.icon} className="size-3" />
                    {st.label}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted">
            <span className="font-semibold text-ink">40 of 42</span> ready to publish
          </p>
          <span className="rounded-lg bg-graphite px-3 py-1.5 text-xs font-semibold text-white dark:bg-white dark:text-graphite">Publish menu</span>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ kitchen & café displays

type Ticket = { where: string; id: string; mins: number; items: { q: number; name: string; note?: string }[]; priority?: boolean; done?: boolean; action?: string };

function KdsTicket({ t }: { t: Ticket }) {
  return (
    <div className={cn('overflow-hidden rounded-xl bg-[#1b1e22] ring-1', t.priority ? 'ring-[#ff7a66]/50' : 'ring-white/[0.08]')}>
      <div className={cn('flex items-center justify-between gap-2 px-3 py-2', t.priority ? 'bg-[#ff7a66]/15' : 'bg-white/[0.04]')}>
        <span className="min-w-0 truncate text-[13px] font-semibold text-white">
          {t.where} <span className="font-normal text-white/45">#{t.id}</span>
        </span>
        <span className={cn('shrink-0 text-[12px] font-medium tabular-nums', t.mins > 10 ? 'text-[#f2b03d]' : 'text-white/60')}>{t.mins} min</span>
      </div>
      {t.priority && <p className="px-3 pt-2 text-[11px] font-semibold tracking-wide text-[#ff9a8a] uppercase">Priority</p>}
      <ul className="space-y-1.5 px-3 py-2.5 text-[13px] text-white/90">
        {t.items.map((i) => (
          <li key={i.name}>
            <span className="font-semibold text-lime">{i.q}×</span> {i.name}
            {i.note && <span className="block ps-5 text-[12px] text-white/50">{i.note}</span>}
          </li>
        ))}
      </ul>
      <div className="px-3 pb-3">
        {t.done ? (
          <span className="flex h-8 items-center justify-center gap-1.5 rounded-lg bg-[#52c983]/15 text-[12px] font-semibold text-[#52c983]">
            <Icon name="checkCircle" className="size-4" />
            Ready
          </span>
        ) : (
          <span className={cn('flex h-8 items-center justify-center rounded-lg text-[12px] font-semibold', t.action === 'Start' ? 'bg-white/10 text-white' : 'bg-lime text-lime-ink')}>
            {t.action ?? 'Mark ready'}
          </span>
        )}
      </div>
    </div>
  );
}

function Screen({ icon, title, meta, children, className }: { icon: IconName; title: string; meta: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-[1.4rem] bg-[#0a0b0d] p-2 shadow-[0_40px_80px_-30px_rgb(0_0_0/0.9)] ring-1 ring-white/10', className)}>
      <div className="h-full rounded-[1rem] bg-[#121417] p-3 sm:p-3.5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-sm font-semibold text-white">
            <span className="flex size-6 items-center justify-center rounded-md bg-lime/15 text-lime">
              <Icon name={icon} className="size-3.5" />
            </span>
            {title}
          </p>
          <p className="text-xs text-white/45 tabular-nums">{meta}</p>
        </div>
        {children}
      </div>
    </div>
  );
}

export function KitchenMock() {
  const kitchen: Ticket[] = [
    { where: 'Table 12', id: '1042', mins: 4, items: [{ q: 1, name: 'Chicken tagine' }, { q: 1, name: 'Vegetable couscous' }] },
    { where: 'Table 4', id: '1036', mins: 13, priority: true, items: [{ q: 3, name: 'Vegetable couscous' }] },
    { where: 'Takeaway', id: '1043', mins: 2, items: [{ q: 2, name: 'Falafel wrap', note: 'No onion' }], action: 'Start' },
  ];
  const cafe: Ticket[] = [
    { where: 'Table 12', id: '1042', mins: 4, items: [{ q: 1, name: 'Mint tea for two' }], done: true },
    { where: 'Table 4', id: '1036', mins: 13, items: [{ q: 1, name: 'Fresh orange juice' }] },
  ];
  return (
    <div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Screen icon="kitchen" title="Kitchen" meta="3 open · 12:35">
          <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
            {kitchen.map((t, i) => (
              <div key={t.id} className={cn(i === 2 && 'hidden xl:block')}>
                <KdsTicket t={t} />
              </div>
            ))}
          </div>
        </Screen>
        <Screen icon="station" title="Café" meta="2 open · 12:35">
          <div className="grid gap-2.5 sm:grid-cols-2">
            {cafe.map((t) => (
              <KdsTicket key={t.id} t={t} />
            ))}
          </div>
        </Screen>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl bg-white/[0.04] px-4 py-3 text-[13px] text-white/75 ring-1 ring-white/10">
        <span className="font-semibold text-white">Table 12 · #1042</span>
        <span className="inline-flex items-center gap-1.5 rounded-lg bg-[#52c983]/15 px-2 py-1 font-medium text-[#52c983]">
          <Icon name="checkCircle" className="size-3.5" /> Café ready
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-lg bg-[#f2b03d]/15 px-2 py-1 font-medium text-[#f2b03d]">
          <Icon name="flame" className="size-3.5" /> Kitchen preparing
        </span>
        <Icon name="arrowRight" className="size-4 text-white/40" />
        <span className="text-white/60">Ready to serve when both are done</span>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ translations

const TRANSLATIONS: { code: string; name: string; text: string; state: 'source' | 'ok' | 'review'; rtl?: boolean; lang: string }[] = [
  { code: 'PT', name: 'Português', text: 'Tajine de frango com limão', state: 'source', lang: 'pt-PT' },
  { code: 'EN', name: 'English', text: 'Chicken tagine with lemon', state: 'ok', lang: 'en' },
  { code: 'FR', name: 'Français', text: 'Tajine de poulet au citron', state: 'ok', lang: 'fr' },
  { code: 'AR', name: 'العربية', text: 'طاجين الدجاج بالليمون', state: 'ok', rtl: true, lang: 'ar' },
  { code: 'ES', name: 'Español', text: 'Tajín de pollo al limón', state: 'review', lang: 'es' },
];

const TRANSLATION_STATE = {
  source: { label: 'Original', className: 'border-line bg-surface-2 text-ink-2' },
  ok: { label: 'Approved', className: 'border-success/20 bg-success/10 text-success' },
  review: { label: 'To review', className: 'border-warning/20 bg-warning/10 text-warning' },
} as const;

export function LanguagesMock() {
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_40px_80px_-32px_rgb(16_18_20/0.28)]">
      <div className="flex items-center gap-3 border-b border-line px-4 py-3">
        <DishArt kind="tagine" className="size-10 rounded-lg" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-ink">Chicken tagine with lemon</p>
          <p className="truncate text-xs text-muted">Mains · Translations</p>
        </div>
        <span className="hidden shrink-0 rounded-md border border-success/20 bg-success/10 px-1.5 py-px text-[11px] font-medium text-success min-[400px]:inline">4 of 5 live</span>
      </div>
      <ul className="divide-y divide-line">
        {TRANSLATIONS.map((t) => {
          const st = TRANSLATION_STATE[t.state];
          return (
            <li key={t.code} className="flex items-center gap-3 px-4 py-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 font-mono text-[11px] font-semibold text-ink-2">{t.code}</span>
              <div lang={t.lang} dir={t.rtl ? 'rtl' : 'ltr'} className="min-w-0 flex-1">
                <p className={cn('truncate text-sm font-medium text-ink', t.rtl && 'text-[15px]')}>{t.text}</p>
                <p className="truncate text-[11px] text-muted">{t.name}</p>
              </div>
              <span className={cn('shrink-0 rounded-md border px-1.5 py-px text-[11px] font-medium', st.className)}>{st.label}</span>
            </li>
          );
        })}
      </ul>
      <div className="border-t border-line bg-surface-2/60 px-4 py-3 text-xs text-muted">Not shown to guests until approved. Until then they see the original.</div>
    </div>
  );
}

/** The guest-facing language switch, as a row of pills. */
export function LanguagePills({ active = 'ar', className }: { active?: string; className?: string }) {
  const langs: [string, string][] = [
    ['pt', 'Português'],
    ['en', 'English'],
    ['fr', 'Français'],
    ['ar', 'العربية'],
    ['es', 'Español'],
  ];
  return (
    <div className={cn('inline-flex max-w-full flex-wrap justify-center gap-1 rounded-2xl border border-line bg-surface p-1 shadow-md', className)}>
      {langs.map(([code, name]) => (
        <span key={code} lang={code} className={cn('rounded-xl px-2.5 py-1 text-xs font-medium', code === active ? 'bg-graphite text-white dark:bg-white dark:text-graphite' : 'text-ink-2')}>
          {name}
        </span>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ reservations & floor plan

const TABLES: { id: string; x: number; y: number; w: number; h: number; round?: boolean; state: 'free' | 'taken' | 'picked' }[] = [
  { id: 'T1', x: 6, y: 20, w: 13, h: 23, round: true, state: 'free' },
  { id: 'T2', x: 25, y: 20, w: 13, h: 23, round: true, state: 'taken' },
  { id: 'T3', x: 45, y: 16, w: 21, h: 28, state: 'picked' },
  { id: 'T4', x: 72, y: 16, w: 21, h: 28, state: 'taken' },
  { id: 'T5', x: 6, y: 60, w: 13, h: 23, round: true, state: 'free' },
  { id: 'T6', x: 25, y: 60, w: 13, h: 23, round: true, state: 'free' },
  { id: 'T7', x: 45, y: 58, w: 48, h: 25, state: 'taken' },
];

const TABLE_STATE = {
  free: 'bg-success/10 text-success ring-1 ring-success/35',
  taken: 'bg-surface-3 text-muted ring-1 ring-line-strong',
  picked: 'bg-lime text-lime-ink shadow-md ring-2 ring-lime/50',
} as const;

export function FloorPlanMock() {
  return (
    <div>
      <div className="relative aspect-[16/9] w-full overflow-hidden rounded-xl border border-line bg-surface-2 [background-image:radial-gradient(var(--mn-border-strong)_1px,transparent_1px)] [background-size:14px_14px]">
        <span className="absolute inset-x-[20%] top-0 h-1 rounded-b-full bg-info/40" />
        <span className="absolute start-2.5 top-2 rounded-md bg-surface/90 px-1.5 py-px text-[11px] font-medium text-ink-2 ring-1 ring-line">Main room</span>
        {TABLES.map((t) => (
          <span
            key={t.id}
            style={{ left: `${t.x}%`, top: `${t.y}%`, width: `${t.w}%`, height: `${t.h}%` }}
            className={cn('absolute flex items-center justify-center text-[11px] font-semibold', t.round ? 'rounded-full' : 'rounded-lg', TABLE_STATE[t.state])}
          >
            {t.id}
          </span>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-success" /> Free
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-line-strong" /> Taken
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-lime" /> Requested
          </span>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2 py-1 text-[11px] font-medium text-ink-2">
          <Icon name="calendar" className="size-3.5" />
          Sat 20:00 · 4 guests · T3
        </span>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ feedback, bills, growth, analytics

const INBOX: { stars: number; where: string; text: string }[] = [
  { stars: 5, where: 'Table 7', text: 'Perfect tagine, lovely staff.' },
  { stars: 2, where: 'Takeaway', text: 'Waited 20 minutes for pickup.' },
];

/** What the restaurant sees (private inbox) above what the guest sees (the feedback form). */
export function FeedbackMock() {
  return (
    <div className="space-y-2.5">
      <div className="rounded-xl border border-line bg-surface p-3">
        <p className="flex items-center justify-between text-[12px]">
          <span className="font-semibold text-ink">Private feedback</span>
          <span className="text-muted">Only your team sees this</span>
        </p>
        <ul className="mt-2 space-y-1.5">
          {INBOX.map((f) => (
            <li key={f.where} className="flex items-center gap-2 rounded-lg bg-surface-2 px-2.5 py-1.5 text-[11px]">
              <span className="flex shrink-0 text-[#f5b301]">
                {[0, 1, 2, 3, 4].map((i) => (
                  <Icon key={i} name="star" className={cn('size-3', i >= f.stars && 'text-line-strong')} fill="currentColor" strokeWidth={1} />
                ))}
              </span>
              <span className="shrink-0 font-medium text-ink">{f.where}</span>
              <span className="truncate text-muted">{f.text}</span>
            </li>
          ))}
        </ul>
      </div>
      <FeedbackForm />
    </div>
  );
}

function FeedbackForm() {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <p className="text-[13px] font-semibold text-ink">How was your visit?</p>
      <div className="mt-2 flex gap-1 text-[#f5b301]">
        {[0, 1, 2, 3, 4].map((i) => (
          <Icon key={i} name="star" className={cn('size-5', i === 4 && 'text-line-strong')} fill="currentColor" strokeWidth={1} />
        ))}
      </div>
      <p className="mt-3 rounded-lg bg-surface-2 px-3 py-2 text-[12px] text-ink-2">“Lovely tagine. The tea took a while.”</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <span className="flex h-9 items-center justify-center gap-1.5 rounded-lg bg-graphite px-2 text-[11px] font-semibold text-white dark:bg-white dark:text-graphite">
          <Icon name="lock" className="size-3.5" /> Send privately
        </span>
        <span className="flex h-9 items-center justify-center gap-1.5 rounded-lg border border-line bg-surface px-2 text-[11px] font-semibold text-ink">
          <Icon name="external" className="size-3.5" /> Google review
        </span>
      </div>
    </div>
  );
}

export function BillMock() {
  const lines: [string, string][] = [
    ['1× Chicken tagine', '€14.50'],
    ['1× Vegetable couscous', '€12.00'],
    ['1× Mint tea for two', '€4.50'],
  ];
  return (
    <div className="rounded-xl border border-line bg-surface p-3.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[13px] font-semibold text-ink">Table 12 · Bill</p>
        <span className="rounded-md bg-surface-2 px-1.5 text-[11px] font-medium text-ink-2">Split 2 ways</span>
      </div>
      <ul className="mt-2.5 space-y-1 text-[12px] text-ink-2">
        {lines.map(([item, price]) => (
          <li key={item} className="flex justify-between gap-2">
            <span className="truncate">{item}</span>
            <span className="tabular-nums">{price}</span>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex justify-between border-t border-line pt-2 text-[13px] font-semibold text-ink">
        <span>Total</span>
        <span className="tabular-nums">€31.00</span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
        <div className="rounded-lg border border-success/25 bg-success/10 px-2 py-1.5 text-success">
          <p className="font-semibold">Guest 1 · €15.50</p>
          <p>Paid by card</p>
        </div>
        <div className="rounded-lg border border-line bg-surface-2 px-2 py-1.5">
          <p className="font-semibold text-ink">Guest 2 · €15.50</p>
          <p className="text-muted">To pay</p>
        </div>
      </div>
    </div>
  );
}

export function GrowMock() {
  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-3 rounded-xl border border-dashed border-line-strong bg-surface p-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
          <Icon name="tag" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold text-ink">LUNCH15 · −15%</p>
          <p className="truncate text-[11px] text-muted">Weekdays 12:00–15:00 · 200 uses left</p>
        </div>
      </div>
      <div className="rounded-xl border border-line bg-surface p-3">
        <div className="flex items-center justify-between text-[12px]">
          <span className="font-semibold text-ink">Loyalty card</span>
          <span className="text-muted">4 / 6 stamps</span>
        </div>
        <div className="mt-2 flex gap-1.5">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <span key={i} className={cn('flex size-7 items-center justify-center rounded-full', i < 4 ? 'bg-lime text-lime-ink' : 'border border-dashed border-line-strong')}>
              {i < 4 && <Icon name="check" className="size-3.5" strokeWidth={2.4} />}
            </span>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-muted">2 more for a free mint tea</p>
      </div>
    </div>
  );
}

const WEEK: [string, number, number][] = [
  ['M', 42, 4],
  ['T', 55, 6],
  ['W', 48, 3],
  ['T', 63, 8],
  ['F', 80, 6],
  ['S', 96, 9],
  ['S', 71, 5],
];

export function AnalyticsMock() {
  return (
    <div className="rounded-xl border border-line bg-surface p-3.5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[12px] text-muted">Paid this week</p>
          <p className="mt-0.5 text-xl font-semibold text-ink tabular-nums">€4,820</p>
        </div>
        <div className="flex gap-2.5 text-[11px] text-muted">
          <span className="inline-flex items-center gap-1">
            <span className="size-2 rounded-sm bg-lime" /> Paid
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="size-2 rounded-sm bg-warning/50" /> Unpaid
          </span>
        </div>
      </div>
      <div className="mt-3 flex h-24 items-end gap-1.5">
        {WEEK.map(([day, paid, unpaid], i) => (
          <div key={i} className="flex h-full flex-1 flex-col justify-end gap-0.5" title={day}>
            <span className="block rounded-sm bg-warning/50" style={{ height: `${unpaid}%` }} />
            <span className={cn('block rounded-sm', i === 5 ? 'bg-lime' : 'bg-lime/60')} style={{ height: `${paid}%` }} />
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-1.5 text-center text-[10px] text-muted">
        {WEEK.map(([day], i) => (
          <span key={i} className="flex-1">
            {day}
          </span>
        ))}
      </div>
    </div>
  );
}
