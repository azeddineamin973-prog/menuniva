'use client';

import { useActionState, useEffect, useMemo, useRef, useState } from 'react';
import { friendlyError } from '@/components/forms/action-form';
import { keepValuesOnSubmit } from '@/components/forms/use-keep-values';
import { ProductThumb } from '@/components/dashboard/product-thumb';
import { Badge, Button, Input, Select } from '@/components/ui';
import { initialActionState } from '@/lib/action-result';
import { cn } from '@/lib/cn';
import { formatCents } from '@/lib/money';
import { bulkUpdateAction } from '../actions';
import { EditDialog } from './edit-dialog';
import { DECISION_BADGE, extrasRule, SOURCE_LABEL, type ReviewItem } from './review-types';

const NO_CATEGORY = '__none__';
const PAGE_SIZES = [25, 50, 100] as const;
type View = 'all' | 'import' | 'skip' | 'attention' | 'nophoto' | 'soldout';
const VIEWS: { v: View; label: string }[] = [
  { v: 'all', label: 'All products' },
  { v: 'import', label: 'Will be imported' },
  { v: 'skip', label: 'Skipped' },
  { v: 'attention', label: 'Needs attention' },
  { v: 'nophoto', label: 'Without photo' },
  { v: 'soldout', label: 'Sold out on platform' },
];

/** Accent- and case-insensitive search key: "Tajíne" matches "tajine". */
const fold = (s: string) => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const needsAttention = (i: ReviewItem) => i.warnings.length > 0 || i.priceCents === null;

function SearchIcon() {
  return (
    <svg viewBox="0 0 20 20" className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <circle cx="9" cy="9" r="5.5" />
      <path d="m13.5 13.5 3 3" strokeLinecap="round" />
    </svg>
  );
}

function Totals({ items, onView }: { items: ReviewItem[]; onView: (v: View) => void }) {
  const categories = new Set(items.map((i) => i.categoryName ?? NO_CATEGORY)).size;
  const photos = items.filter((i) => i.imageUrl).length;
  const options = items.filter((i) => i.sizes.length || i.extras.length).length;
  const attention = items.filter(needsAttention).length;
  const ready = items.filter((i) => i.decision === 'CREATE').length;
  const tiles: { label: string; value: string; hint?: string; view?: View; tone?: string }[] = [
    { label: 'Products', value: String(items.length), view: 'all' },
    { label: 'Categories', value: String(categories) },
    { label: 'With photos', value: `${photos}`, hint: `of ${items.length}`, view: photos < items.length ? 'nophoto' : undefined },
    { label: 'Sizes & extras', value: String(options), hint: options === 1 ? 'product' : 'products' },
    { label: 'Need attention', value: String(attention), view: attention ? 'attention' : undefined, tone: attention ? 'text-warning' : undefined },
    { label: 'Ready to import', value: String(ready), view: 'import', tone: 'text-success' },
  ];
  return (
    <div className="grid grid-cols-2 overflow-hidden rounded-[var(--radius-card)] border border-line bg-line [gap:1px] sm:grid-cols-3 lg:grid-cols-6" data-testid="import-summary">
      {tiles.map((t) => {
        const body = (
          <>
            <span className="block text-xs text-muted">{t.label}</span>
            <span className={cn('mt-1 block text-2xl font-semibold tracking-tight tabular-nums', t.tone ?? 'text-ink')}>
              {t.value}
              {t.hint && <span className="ms-1 text-xs font-normal text-muted">{t.hint}</span>}
            </span>
          </>
        );
        return t.view ? (
          <button key={t.label} type="button" onClick={() => onView(t.view!)} className="bg-surface px-4 py-3.5 text-start transition-colors hover:bg-surface-2" data-testid={`total-${t.label}`}>
            {body}
          </button>
        ) : (
          <div key={t.label} className="bg-surface px-4 py-3.5" data-testid={`total-${t.label}`}>
            {body}
          </div>
        );
      })}
    </div>
  );
}

function pageWindow(page: number, pages: number): (number | '…')[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const set = new Set([1, pages, page - 1, page, page + 1].filter((p) => p >= 1 && p <= pages));
  const sorted = [...set].sort((a, b) => a - b);
  const out: (number | '…')[] = [];
  sorted.forEach((p, i) => {
    if (i && p - sorted[i - 1] > 1) out.push('…');
    out.push(p);
  });
  return out;
}

export function ReviewTable({
  org,
  jobId,
  items,
  editable,
  categories,
  existingProducts,
}: {
  org: string;
  jobId: string;
  items: ReviewItem[];
  editable: boolean;
  categories: string[];
  existingProducts: { id: string; name: string }[];
}) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [view, setView] = useState<View>('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(25);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<ReviewItem | null>(null);
  const [bulkState, bulkAction, bulkPending] = useActionState(bulkUpdateAction, initialActionState);
  const tableTop = useRef<HTMLDivElement>(null);

  const allPlatform = items.every((i) => i.platform);
  const platformLabel = allPlatform ? `${SOURCE_LABEL[items[0]?.sourceType] ?? 'Platform'} price` : 'Price';

  const categoryCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of items) m.set(i.categoryName ?? NO_CATEGORY, (m.get(i.categoryName ?? NO_CATEGORY) ?? 0) + 1);
    return m;
  }, [items]);
  // Categories in the order they appear on the source menu.
  const categoryOrder = useMemo(() => [...new Set(items.map((i) => i.categoryName ?? NO_CATEGORY))], [items]);

  const filtered = useMemo(() => {
    const q = fold(query.trim());
    return items.filter((i) => {
      if (category !== 'all' && (i.categoryName ?? NO_CATEGORY) !== category) return false;
      if (view === 'import' && i.decision !== 'CREATE') return false;
      if (view === 'skip' && i.decision !== 'SKIP') return false;
      if (view === 'attention' && !needsAttention(i)) return false;
      if (view === 'nophoto' && i.imageUrl) return false;
      if (view === 'soldout' && i.available !== false) return false;
      if (q && !fold(`${i.name} ${i.description ?? ''} ${i.categoryName ?? ''}`).includes(q)) return false;
      return true;
    });
  }, [items, query, category, view]);

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const current = Math.min(page, pages);
  const rows = filtered.slice((current - 1) * pageSize, current * pageSize);
  const pageIds = rows.map((r) => r.id);
  const pageAllSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const pageSomeSelected = pageIds.some((id) => selected.has(id));
  const filtersActive = query.trim() !== '' || category !== 'all' || view !== 'all';

  // Filters always start again on page 1.
  useEffect(() => setPage(1), [query, category, view, pageSize]);
  // A finished bulk action clears the selection.
  useEffect(() => {
    if (bulkState.ok) setSelected(new Set());
  }, [bulkState]);
  // Products removed by a new extraction cannot stay selected.
  useEffect(() => {
    const ids = new Set(items.map((i) => i.id));
    setSelected((s) => (([...s].every((id) => ids.has(id)) ? s : new Set([...s].filter((id) => ids.has(id))))));
  }, [items]);

  const headerBox = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (headerBox.current) headerBox.current.indeterminate = pageSomeSelected && !pageAllSelected;
  }, [pageSomeSelected, pageAllSelected]);

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const togglePage = () =>
    setSelected((s) => {
      const n = new Set(s);
      if (pageAllSelected) pageIds.forEach((id) => n.delete(id));
      else pageIds.forEach((id) => n.add(id));
      return n;
    });
  const goTo = (p: number) => {
    setPage(p);
    tableTop.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };
  const clearFilters = () => {
    setQuery('');
    setCategory('all');
    setView('all');
  };
  const bulkError = !bulkState.ok && bulkState.error ? (bulkState.error === 'validation' ? 'Enter a category name to move the products.' : friendlyError(bulkState.error)) : null;

  return (
    <div className="space-y-4">
      <Totals items={items} onView={(v) => { setCategory('all'); setQuery(''); setView(v); }} />

      <section className="rounded-[var(--radius-card)] border border-line bg-surface" aria-label="Imported products" data-testid="review-table">
        <div ref={tableTop} className="scroll-mt-4 space-y-3 border-b border-line px-4 py-3.5 sm:px-5">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
            <div className="relative min-w-0 flex-1">
              <SearchIcon />
              <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search products" aria-label="Search products" className="ps-9" data-testid="product-search" />
            </div>
            <div className="grid grid-cols-2 gap-2 sm:flex">
              <Select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category" className="sm:w-56" data-testid="category-filter">
                <option value="all">All categories</option>
                {categoryOrder.map((c) => (
                  <option key={c} value={c}>
                    {c === NO_CATEGORY ? 'No category' : c} ({categoryCounts.get(c)})
                  </option>
                ))}
              </Select>
              <Select value={view} onChange={(e) => setView(e.target.value as View)} aria-label="Show" className="sm:w-52" data-testid="view-filter">
                {VIEWS.map((v) => (
                  <option key={v.v} value={v.v}>
                    {v.label}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          {editable && selected.size > 0 && (
            <form onSubmit={keepValuesOnSubmit(bulkAction)} className="flex flex-wrap items-center gap-2 rounded-xl bg-graphite px-3 py-2 text-sm text-white dark:bg-surface-2" data-testid="bulk-bar">
              <input type="hidden" name="org" value={org} />
              <input type="hidden" name="jobId" value={jobId} />
              <input type="hidden" name="ids" value={[...selected].join(',')} />
              <span className="me-1 font-medium tabular-nums" data-testid="selected-count">
                {selected.size} selected
              </span>
              <Button type="submit" name="action" value="include" size="sm" disabled={bulkPending}>
                Import
              </Button>
              <Button type="submit" name="action" value="skip" size="sm" variant="secondary" disabled={bulkPending} className="text-ink">
                Skip
              </Button>
              <span className="flex items-center gap-1.5">
                <Input
                  name="categoryName"
                  list="bulk-categories"
                  placeholder="Move to category…"
                  aria-label="Move to category"
                  className="h-8! w-44! border-white/25! bg-white/10! text-white! placeholder:text-white/60! dark:bg-surface! dark:text-ink! dark:placeholder:text-muted!"
                />
                <datalist id="bulk-categories">
                  {categories.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
                <Button type="submit" name="action" value="category" size="sm" variant="secondary" disabled={bulkPending} className="text-ink">
                  Move
                </Button>
              </span>
              <button type="button" onClick={() => setSelected(new Set())} className="ms-auto text-xs text-white/80 underline-offset-2 hover:underline dark:text-muted">
                Clear selection
              </button>
              {bulkError && (
                <p role="alert" className="w-full text-xs text-[#ffb4a8]">
                  {bulkError}
                </p>
              )}
            </form>
          )}
          {editable && pageAllSelected && filtered.length > rows.length && selected.size < filtered.length && (
            <p className="text-xs text-muted">
              All {rows.length} products on this page are selected.{' '}
              <button type="button" className="font-medium text-ink underline-offset-2 hover:underline" onClick={() => setSelected(new Set(filtered.map((f) => f.id)))} data-testid="select-all-matching">
                Select all {filtered.length} matching products
              </button>
            </p>
          )}
        </div>

        {filtered.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <p className="text-sm font-medium text-ink">No products match these filters.</p>
            {filtersActive && (
              <button type="button" onClick={clearFilters} className="mt-2 text-sm text-muted underline-offset-2 hover:underline">
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            {/* Fixed layout: the side columns get set widths and the product column takes the rest. */}
            <table className="w-full table-fixed text-sm" data-testid="import-items">
              <caption className="sr-only">Products found by the import</caption>
              <thead className="text-xs text-muted">
                <tr className="border-b border-line">
                  {editable && (
                    <th scope="col" className="w-11 py-2.5 ps-4 sm:w-12 sm:ps-5">
                      <label className="-m-2 inline-flex cursor-pointer p-2">
                        <input ref={headerBox} type="checkbox" checked={pageAllSelected} onChange={togglePage} aria-label="Select all products on this page" className="size-4 accent-[#7ac70c] pointer-coarse:size-5" data-testid="select-page" />
                      </label>
                    </th>
                  )}
                  <th scope="col" className={cn('py-2.5 text-start font-medium', editable ? 'w-15' : 'w-19 ps-4 sm:w-20 sm:ps-5')}>
                    <span className="sr-only">Photo</span>
                  </th>
                  <th scope="col" className="py-2.5 pe-3 text-start font-medium">Product</th>
                  <th scope="col" className="hidden w-44 px-3 py-2.5 text-start font-medium md:table-cell xl:w-52">Category</th>
                  <th scope="col" className="hidden w-28 px-3 py-2.5 text-end font-medium sm:table-cell">{platformLabel}</th>
                  <th scope="col" className="hidden w-28 px-3 py-2.5 text-start font-medium sm:table-cell">Status</th>
                  {editable && (
                    <th scope="col" className="w-17 py-2.5 pe-4 sm:w-20 sm:pe-5">
                      <span className="sr-only">Actions</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map((i) => {
                  const badge = DECISION_BADGE[i.decision];
                  const isSelected = selected.has(i.id);
                  return (
                    <tr key={i.id} className={cn('border-t border-line align-top transition-colors first:border-t-0', isSelected ? 'bg-lime/10' : 'hover:bg-surface-2/60')} data-testid="import-item">
                      {editable && (
                        <td className="py-3 ps-4 sm:ps-5">
                          {/* The label pads the checkbox into a finger-sized target. */}
                          <label className="-m-2 mt-1.5 inline-flex cursor-pointer p-2">
                            <input type="checkbox" checked={isSelected} onChange={() => toggle(i.id)} aria-label={`Select ${i.name}`} className="size-4 accent-[#7ac70c] pointer-coarse:size-5" data-testid="select-item" />
                          </label>
                        </td>
                      )}
                      <td className={cn('py-3 pe-3', !editable && 'ps-4 sm:ps-5')}>
                        <ProductThumb src={i.imageUrl} />
                      </td>
                      <td className="py-3 pe-3">
                        <div className="flex min-w-0 items-center gap-2">
                          <p className="min-w-0 truncate font-medium text-ink" title={i.name} data-testid="item-name">
                            {i.name}
                          </p>
                          {i.available === false && (
                            <Badge tone="warning" className="shrink-0" data-testid="item-sold-out">
                              Sold out
                            </Badge>
                          )}
                        </div>
                        {i.description && <p className="mt-0.5 line-clamp-2 text-xs text-muted">{i.description}</p>}
                        <p className="mt-1 text-xs text-muted md:hidden">
                          {i.categoryName ?? 'No category'}
                          <span className="sm:hidden">
                            {' · '}
                            <span className="text-ink tabular-nums">{i.priceCents === null ? 'no price' : formatCents(i.priceCents)}</span> · {badge.label}
                          </span>
                        </p>
                        {(i.sizes.length > 0 || i.extras.length > 0) && (
                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                            {i.sizes.length > 0 && (
                              <span
                                className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px] text-ink/80"
                                title={i.sizes.map((s) => `${s.name}${s.priceCents !== undefined ? ` ${formatCents(s.priceCents)}` : ''}`).join(' · ')}
                                data-testid="item-sizes"
                              >
                                Sizes: {i.sizes.map((s) => `${s.name}${s.priceCents !== undefined ? ` ${formatCents(s.priceCents)}` : ''}`).join(' · ')}
                              </span>
                            )}
                            {i.extras.map((g) => (
                              <span
                                key={g.name}
                                className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px] text-ink/80"
                                title={g.options.map((o) => `${o.name}${o.priceDeltaCents ? ` +${formatCents(o.priceDeltaCents)}` : ''}`).join(' · ')}
                                data-testid="item-extras"
                              >
                                {g.name} · {g.options.length} {g.options.length === 1 ? 'option' : 'options'} · {extrasRule(g)}
                              </span>
                            ))}
                          </div>
                        )}
                        {i.warnings.length > 0 && (
                          <p className="mt-1 text-xs text-warning" title={i.warnings.join('\n')}>
                            ⚠ {i.warnings[0]}
                            {i.warnings.length > 1 && <span className="text-muted"> +{i.warnings.length - 1}</span>}
                          </p>
                        )}
                        {i.similarTo && i.decision === 'SKIP' && <p className="mt-1 text-xs text-muted">Matches “{i.similarTo}” on your menu</p>}
                      </td>
                      <td className="hidden truncate px-3 py-3 text-sm text-muted md:table-cell" title={i.categoryName ?? undefined}>
                        {i.categoryName ?? <span className="text-muted/70">—</span>}
                      </td>
                      <td className="hidden px-3 py-3 text-end font-medium tabular-nums sm:table-cell">{i.priceCents === null ? <span className="font-normal text-muted">—</span> : formatCents(i.priceCents)}</td>
                      <td className="hidden px-3 py-3 sm:table-cell">
                        <Badge tone={badge.tone} data-testid="item-status">
                          {badge.label}
                        </Badge>
                      </td>
                      {editable && (
                        <td className="py-2.5 pe-4 text-end sm:pe-5">
                          <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(i)} data-testid="edit-item" aria-label={`Edit ${i.name}`}>
                            Edit
                          </Button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {filtered.length > 0 && (
          <div className="flex flex-col gap-3 border-t border-line px-4 py-3 text-xs text-muted sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <p data-testid="pagination-status">
              Showing {(current - 1) * pageSize + 1}–{Math.min(current * pageSize, filtered.length)} of {filtered.length}
              {filtered.length !== items.length && ` (filtered from ${items.length})`}
            </p>
            <div className="flex items-center gap-3">
              <label className="hidden items-center gap-1.5 sm:flex">
                Rows
                {/* `!` because the kit's Select sets h-10/w-full and cn() does not dedupe classes. */}
                <Select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} className="h-8! w-24! text-xs" aria-label="Rows per page">
                  {PAGE_SIZES.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </Select>
              </label>
              {pages > 1 && (
                <nav className="flex items-center gap-1" aria-label="Pagination" data-testid="pagination">
                  <Button type="button" variant="ghost" size="sm" onClick={() => goTo(current - 1)} disabled={current === 1} aria-label="Previous page">
                    ‹
                  </Button>
                  {pageWindow(current, pages).map((p, idx) =>
                    p === '…' ? (
                      <span key={`gap${idx}`} className="px-1">
                        …
                      </span>
                    ) : (
                      <Button key={p} type="button" variant={p === current ? 'dark' : 'ghost'} size="sm" onClick={() => goTo(p)} aria-current={p === current ? 'page' : undefined} aria-label={`Page ${p}`} className="min-w-8 px-2!">
                        {p}
                      </Button>
                    ),
                  )}
                  <Button type="button" variant="ghost" size="sm" onClick={() => goTo(current + 1)} disabled={current === pages} aria-label="Next page">
                    ›
                  </Button>
                </nav>
              )}
            </div>
          </div>
        )}
      </section>

      {editing && <EditDialog key={editing.id} item={editing} org={org} jobId={jobId} categories={categories} existingProducts={existingProducts} onClose={() => setEditing(null)} />}
    </div>
  );
}
