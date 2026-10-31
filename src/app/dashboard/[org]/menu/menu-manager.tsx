'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { Badge, Button, buttonClass, Card, EmptyState, Icon, IconButton } from '@/components/ui';
import { Dialog } from '@/components/ui/dialog';
import { Menu } from '@/components/ui/menu';
import { useToast } from '@/components/ui/toast';
import { initialActionState, type ActionResult } from '@/lib/action-result';
import { cn } from '@/lib/cn';
import { formatCents } from '@/lib/money';
import { bulkAvailabilityAction, bulkVisibilityAction, deleteCategoryAction, moveCategoryAction, moveProductAction, toggleSoldOutAction } from './actions';

export type MenuDish = {
  id: string;
  name: string;
  status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
  soldOut: boolean;
  featured: boolean;
  popular: boolean;
  image: string | null;
  dineIn: number | null;
  takeaway: number | null;
  delivery: number | null;
  noStation: boolean;
  allergens: boolean;
  missingTranslations: number;
};
export type MenuCategoryView = { id: string; name: string; isActive: boolean; stationName: string | null; languages: string; products: MenuDish[] };

type Filter = 'all' | 'visible' | 'draft' | 'soldOut' | 'noPrice' | 'noPhoto';
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'visible', label: 'Visible' },
  { key: 'draft', label: 'Drafts' },
  { key: 'soldOut', label: 'Sold out' },
  { key: 'noPrice', label: 'No price' },
  { key: 'noPhoto', label: 'No photo' },
];
const matches = (d: MenuDish, f: Filter) =>
  f === 'all' ||
  (f === 'visible' && d.status === 'ACTIVE' && !d.soldOut) ||
  (f === 'draft' && d.status === 'DRAFT') ||
  (f === 'soldOut' && d.soldOut) ||
  (f === 'noPrice' && d.dineIn === null) ||
  (f === 'noPhoto' && !d.image);
const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Action = (prev: ActionResult<any>, form: FormData) => Promise<ActionResult<any>>;

/**
 * Menu management: search, filter by status, jump between categories, and change several
 * dishes at once. Every change goes through the same server actions as before.
 */
export function MenuManager({
  org,
  base,
  tag,
  categories,
  canEdit,
  canAvailability,
  addCategory,
  emptyAction,
}: {
  org: string;
  base: string;
  tag: string;
  categories: MenuCategoryView[];
  canEdit: boolean;
  canAvailability: boolean;
  /** Server-rendered "new category" form (kept as a regular form). Rendered once. */
  addCategory?: React.ReactNode;
  /** Shown in the empty-menu state (e.g. "Import menu"). */
  emptyAction?: React.ReactNode;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [category, setCategory] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState<MenuCategoryView | null>(null);
  const money = (c: number | null) => (c === null ? null : formatCents(c, tag));

  const all = categories.flatMap((c) => c.products);
  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.key, all.filter((d) => matches(d, f.key)).length])) as Record<Filter, number>, [all]);
  const needle = fold(q.trim());
  const shown = categories
    .filter((c) => !category || c.id === category)
    .map((c) => ({ ...c, products: c.products.filter((d) => matches(d, filter) && (!needle || fold(d.name).includes(needle))) }))
    // While searching or filtering, empty categories are hidden; otherwise they stay (to add dishes).
    .filter((c) => c.products.length > 0 || (!needle && filter === 'all'));
  // Reordering only makes sense on the full list.
  const reorderable = !needle && filter === 'all';
  const visibleIds = shown.flatMap((c) => c.products.map((d) => d.id));
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));

  const run = (action: Action, fields: Record<string, string | string[]>, success?: string) =>
    start(async () => {
      const form = new FormData();
      for (const [k, v] of Object.entries({ org, ...fields })) for (const x of Array.isArray(v) ? v : [v]) form.append(k, x);
      const res = await action(initialActionState, form);
      if (!res.ok) toast(res.error === 'validation' ? 'Please check the values.' : (res.error ?? 'Could not save.'), 'error');
      else {
        const data = res.data as { updated?: number; skipped?: number } | undefined;
        if (success) toast(data?.skipped ? `${success} ${data.skipped} skipped (no dine-in price).` : success);
        router.refresh();
      }
    });
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const bulk = (action: Action, fields: Record<string, string>, label: string) => {
    const ids = [...selected].filter((id) => all.some((d) => d.id === id));
    run(action, { ...fields, productIds: ids }, `${label}: ${ids.length} dish${ids.length === 1 ? '' : 'es'}.`);
    setSelected(new Set());
  };

  if (categories.length === 0) {
    return (
      <div className="space-y-4">
        <EmptyState
          icon="book"
          title="Your menu is empty"
          description="Add your first category below, or import your existing menu from a file or link. MenuNiva never adds sample dishes to your restaurant."
          action={emptyAction}
        />
        <div className="max-w-xl">{addCategory}</div>
      </div>
    );
  }

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[15rem_minmax(0,1fr)]">
      {/* Category rail (desktop) */}
      <aside className="hidden lg:sticky lg:top-20 lg:block" aria-label="Categories">
        <Card className="mn-scroll max-h-[calc(100dvh-7rem)] overflow-y-auto p-1.5">
          <ul className="space-y-px">
            <li>
              <RailItem active={!category} onClick={() => setCategory(null)} label="All dishes" count={all.length} />
            </li>
            {categories.map((c) => (
              <li key={c.id}>
                <RailItem active={category === c.id} onClick={() => setCategory(c.id)} label={c.name} count={c.products.length} muted={!c.isActive} />
              </li>
            ))}
          </ul>
          {canEdit && (
            <a href="#new-category" className="mt-1 flex min-h-8 items-center gap-2 rounded-lg border-t border-line px-2.5 pt-1 text-[13px] text-muted hover:text-ink">
              <Icon name="plus" className="size-3.5" /> New category
            </a>
          )}
        </Card>
      </aside>

      <div className="min-w-0 space-y-4">
        {/* Toolbar */}
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative min-w-0 flex-1 basis-56">
              <span className="sr-only">Search dishes</span>
              <Icon name="search" className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search dishes…"
                className="h-9 w-full rounded-lg border border-line bg-surface ps-9 pe-3 text-sm shadow-xs placeholder:text-muted/70 hover:border-line-strong focus:border-[var(--mn-focus)] focus:ring-3 focus:ring-[var(--mn-focus)]/20 focus:outline-none pointer-coarse:h-11 pointer-coarse:text-base"
                data-testid="menu-search-admin"
              />
            </label>
            {/* Category picker on phones and tablets (the rail is desktop-only). */}
            <select
              value={category ?? ''}
              onChange={(e) => setCategory(e.target.value || null)}
              aria-label="Category"
              className="h-9 rounded-lg border border-line bg-surface px-3 pe-8 text-sm shadow-xs lg:hidden pointer-coarse:h-11 pointer-coarse:text-base"
            >
              <option value="">All categories ({all.length})</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.products.length})
                </option>
              ))}
            </select>
          </div>
          <div className="mn-scroll -mx-4 flex gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0" role="group" aria-label="Filter dishes">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                aria-pressed={filter === f.key}
                onClick={() => setFilter(f.key)}
                className={cn(
                  'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-[13px] font-medium whitespace-nowrap transition-colors pointer-coarse:h-10',
                  filter === f.key ? 'border-ink bg-ink text-bg' : 'border-line bg-surface text-ink-2 hover:border-line-strong',
                )}
                data-testid={`menu-filter-${f.key}`}
              >
                {f.label}
                <span className={cn('rounded px-1 text-[11px] tabular-nums', filter === f.key ? 'bg-white/15' : 'bg-surface-2 text-muted')}>{counts[f.key]}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Bulk actions appear as soon as a dish is selected. */}
        {selected.size > 0 && (
          <div className="animate-pop-in sticky top-16 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-graphite px-3 py-2 text-white shadow-lg dark:bg-surface-3" data-testid="bulk-bar">
            <span className="me-1 text-sm font-medium tabular-nums">{selected.size} selected</span>
            {canAvailability && (
              <>
                <button type="button" disabled={pending} onClick={() => bulk(bulkAvailabilityAction, { soldOut: 'true' }, 'Marked sold out')} className={buttonClass('secondary', 'sm', 'border-white/15 bg-white/10 text-white hover:bg-white/15')} data-testid="bulk-sold-out">
                  <Icon name="eyeOff" /> Sold out
                </button>
                <button type="button" disabled={pending} onClick={() => bulk(bulkAvailabilityAction, { soldOut: 'false' }, 'Available again')} className={buttonClass('secondary', 'sm', 'border-white/15 bg-white/10 text-white hover:bg-white/15')} data-testid="bulk-available">
                  <Icon name="check" /> Available
                </button>
              </>
            )}
            {canEdit && (
              <>
                <button type="button" disabled={pending} onClick={() => bulk(bulkVisibilityAction, { status: 'ACTIVE' }, 'Visible to guests')} className={buttonClass('secondary', 'sm', 'border-white/15 bg-white/10 text-white hover:bg-white/15')} data-testid="bulk-visible">
                  <Icon name="eye" /> Show
                </button>
                <button type="button" disabled={pending} onClick={() => bulk(bulkVisibilityAction, { status: 'DRAFT' }, 'Moved to drafts')} className={buttonClass('secondary', 'sm', 'border-white/15 bg-white/10 text-white hover:bg-white/15')} data-testid="bulk-draft">
                  <Icon name="eyeOff" /> Hide (draft)
                </button>
              </>
            )}
            <button type="button" onClick={() => setSelected(new Set())} className="ms-auto inline-flex h-8 items-center rounded-lg px-2 text-[13px] text-white/75 hover:bg-white/10 hover:text-white pointer-coarse:h-10">
              Clear
            </button>
          </div>
        )}

        {shown.length === 0 ? (
          <EmptyState icon="search" title={needle || filter !== 'all' ? 'No dishes match' : 'No dishes yet'} description={needle || filter !== 'all' ? 'Try another search or filter.' : 'Add a dish to a category, or import your menu.'} />
        ) : (
          <>
            {(canEdit || canAvailability) && visibleIds.length > 0 && (
              <label className="inline-flex min-h-8 cursor-pointer items-center gap-2 px-1 text-[13px] text-muted pointer-coarse:min-h-10">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={() => setSelected(allVisibleSelected ? new Set() : new Set(visibleIds))}
                  className="size-4 accent-[#6cb30a] pointer-coarse:size-5"
                  data-testid="select-all-dishes"
                />
                Select all {visibleIds.length} shown
              </label>
            )}
            {shown.map((c) => {
              const ci = categories.findIndex((x) => x.id === c.id);
              return (
                <Card key={c.id} data-testid="menu-category" className="overflow-hidden">
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-line bg-surface-2/40 px-4 py-2.5 sm:px-5">
                    <div className="min-w-0">
                      <h2 className="flex flex-wrap items-center gap-2 text-[15px] font-semibold text-ink">
                        {c.name}
                        {!c.isActive && <Badge>Hidden</Badge>}
                      </h2>
                      <p className="text-xs text-muted">
                        {c.products.length} dish{c.products.length === 1 ? '' : 'es'} · station: {c.stationName ?? 'not set'} · {c.languages}
                      </p>
                    </div>
                    {canEdit && (
                      <div className="flex items-center gap-1">
                        <IconButton icon="arrowUp" label="Move category up" size="sm" disabled={pending || ci === 0} onClick={() => run(moveCategoryAction, { id: c.id, dir: 'up' })} />
                        <IconButton icon="arrowDown" label="Move category down" size="sm" disabled={pending || ci === categories.length - 1} onClick={() => run(moveCategoryAction, { id: c.id, dir: 'down' })} />
                        <Menu
                          label={`Category actions for ${c.name}`}
                          triggerClassName="flex size-8 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink pointer-coarse:size-10"
                          trigger={<Icon name="more" />}
                          items={[
                            { label: 'Edit category', href: `${base}/menu/categories/${c.id}`, icon: 'edit' },
                            ...(c.products.length === 0 ? [{ type: 'button' as const, label: 'Delete category', icon: 'trash' as const, danger: true, onSelect: () => setConfirmDelete(c) }] : []),
                          ]}
                        />
                        <Link href={`${base}/menu/products/new?category=${c.id}`} className={buttonClass('secondary', 'sm', 'ms-1')} data-testid={`add-dish-${ci}`}>
                          <Icon name="plus" /> Add dish
                        </Link>
                      </div>
                    )}
                  </div>
                  {c.products.length === 0 ? (
                    <p className="px-5 py-4 text-sm text-muted">No dishes in this category yet.</p>
                  ) : (
                    <ul className="divide-y divide-line">
                      {c.products.map((p, pi) => (
                        <DishRow
                          key={p.id}
                          p={p}
                          base={base}
                          money={money}
                          canEdit={canEdit}
                          canMove={canEdit && reorderable}
                          canAvailability={canAvailability}
                          selected={selected.has(p.id)}
                          onSelect={() => toggle(p.id)}
                          busy={pending}
                          first={pi === 0}
                          last={pi === c.products.length - 1}
                          onSoldOut={() => run(toggleSoldOutAction, { productId: p.id, soldOut: String(!p.soldOut) }, p.soldOut ? `${p.name} is available again.` : `${p.name} marked sold out.`)}
                          onMove={(dir) => run(moveProductAction, { productId: p.id, dir })}
                        />
                      ))}
                    </ul>
                  )}
                </Card>
              );
            })}
          </>
        )}
        <div className="max-w-xl">{addCategory}</div>
      </div>

      <Dialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        title={`Delete “${confirmDelete?.name ?? ''}”?`}
        description="The category is empty. This cannot be undone."
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmDelete(null)}>
              Keep it
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                const c = confirmDelete!;
                setConfirmDelete(null);
                run(deleteCategoryAction, { id: c.id }, `Category “${c.name}” deleted.`);
              }}
            >
              Delete category
            </Button>
          </>
        }
      />
    </div>
  );
}

function RailItem({ active, onClick, label, count, muted }: { active: boolean; onClick: () => void; label: string; count: number; muted?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn('flex min-h-8 w-full items-center justify-between gap-2 rounded-lg px-2.5 text-start text-[13px] transition-colors', active ? 'bg-surface-2 font-medium text-ink' : 'text-ink-2 hover:bg-surface-2/70', muted && 'opacity-60')}
    >
      <span className="truncate">{label}</span>
      <span className="text-xs text-muted tabular-nums">{count}</span>
    </button>
  );
}

function DishRow({
  p,
  base,
  money,
  canEdit,
  canMove,
  canAvailability,
  selected,
  onSelect,
  busy,
  first,
  last,
  onSoldOut,
  onMove,
}: {
  p: MenuDish;
  base: string;
  money: (c: number | null) => string | null;
  canEdit: boolean;
  canMove: boolean;
  canAvailability: boolean;
  selected: boolean;
  onSelect: () => void;
  busy: boolean;
  first: boolean;
  last: boolean;
  onSoldOut: () => void;
  onMove: (dir: 'up' | 'down') => void;
}) {
  return (
    <li
      className={cn(
        // Phones: checkbox, photo and name on the first line; price and actions on the second.
        // From `sm` up everything sits on one line.
        'grid grid-cols-[auto_2.75rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 px-4 py-2.5 transition-colors sm:grid-cols-[auto_2.75rem_minmax(0,1fr)_auto_auto] sm:gap-y-2 sm:px-5',
        selected ? 'bg-accent-soft/60' : 'hover:bg-surface-2/40',
      )}
      data-testid="menu-product"
    >
      {canEdit || canAvailability ? (
        <label className="-m-2 flex cursor-pointer p-2">
          <input type="checkbox" checked={selected} onChange={onSelect} aria-label={`Select ${p.name}`} className="size-4 accent-[#6cb30a] pointer-coarse:size-5" />
        </label>
      ) : (
        <span />
      )}
      {canEdit ? (
        <Link
          href={`${base}/menu/products/${p.id}#photos`}
          className="group relative block size-11 shrink-0 overflow-hidden rounded-lg border border-line bg-surface-2"
          title={p.image ? 'Change photo' : 'Add photo'}
          aria-label={`${p.image ? 'Change' : 'Add'} photo for ${p.name}`}
          data-testid="menu-photo-link"
        >
          {p.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.image} alt="" className="size-11 object-cover" loading="lazy" decoding="async" />
          ) : (
            <span className="flex size-11 items-center justify-center text-muted/70">
              <Icon name="photo" />
            </span>
          )}
          <span className="absolute inset-0 hidden items-center justify-center bg-black/45 text-[10px] font-semibold text-white group-hover:flex group-focus-visible:flex">{p.image ? 'Change' : 'Add'}</span>
        </Link>
      ) : p.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={p.image} alt="" className="size-11 rounded-lg object-cover" loading="lazy" />
      ) : (
        <span className="size-11 rounded-lg bg-surface-2" aria-hidden />
      )}
      <div className="col-span-2 min-w-0 sm:col-span-1">
        {canEdit ? (
          <Link href={`${base}/menu/products/${p.id}`} className="text-sm font-medium break-words text-ink hover:underline">
            {p.name}
          </Link>
        ) : (
          <p className="text-sm font-medium text-ink">{p.name}</p>
        )}
        <div className="mt-0.5 flex flex-wrap items-center gap-1">
          {p.status === 'DRAFT' && <Badge tone="warning">Draft — not visible</Badge>}
          {p.status === 'ACTIVE' && !p.soldOut && (
            <Badge tone="success" dot>
              Visible
            </Badge>
          )}
          {p.soldOut && (
            <Badge tone="danger" dot>
              Sold out
            </Badge>
          )}
          {p.featured && <Badge tone="lime">Featured</Badge>}
          {p.popular && <Badge>Popular</Badge>}
          {p.noStation && <Badge tone="warning">No station</Badge>}
          {p.allergens && <Badge tone="info">Allergens</Badge>}
          {p.missingTranslations > 0 && <Badge>{p.missingTranslations} translations required</Badge>}
        </div>
      </div>
      <div className="col-span-2 col-start-2 row-start-2 min-w-0 text-sm tabular-nums sm:col-span-1 sm:col-start-auto sm:row-start-auto sm:text-end">
        <p className="font-semibold whitespace-nowrap text-ink">{p.dineIn !== null ? money(p.dineIn) : <span className="text-danger">No dine-in price</span>}</p>
        <p className="text-xs text-muted sm:whitespace-nowrap">
          <span className="whitespace-nowrap">Takeaway {money(p.takeaway) ?? '—'}</span> · <span className="whitespace-nowrap">Delivery {money(p.delivery) ?? '—'}</span>
        </p>
      </div>
      <div className="col-start-4 row-start-2 flex items-center justify-self-end gap-1 sm:col-start-auto sm:row-start-auto">
        {canAvailability && (
          <Button size="sm" variant={p.soldOut ? 'primary' : 'secondary'} disabled={busy} onClick={onSoldOut} data-testid="toggle-sold-out">
            {p.soldOut ? 'Mark available' : 'Sold out'}
          </Button>
        )}
        {canMove && (
          <>
            <IconButton icon="arrowUp" label="Move up" size="sm" disabled={busy || first} onClick={() => onMove('up')} />
            <IconButton icon="arrowDown" label="Move down" size="sm" disabled={busy || last} onClick={() => onMove('down')} />
          </>
        )}
      </div>
    </li>
  );
}
