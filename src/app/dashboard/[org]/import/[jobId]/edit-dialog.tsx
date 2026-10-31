'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { friendlyError } from '@/components/forms/action-form';
import { keepValuesOnSubmit } from '@/components/forms/use-keep-values';
import { ProductThumb } from '@/components/dashboard/product-thumb';
import { Alert, Button, Field, Input, Select, Textarea, Icon } from '@/components/ui';
import { initialActionState } from '@/lib/action-result';
import { centsToInputValue, formatCents } from '@/lib/money';
import { saveImportItemAction } from '../actions';
import { PhotoPanel } from './photo-panel';
import { extrasRule, SOURCE_LABEL, type ReviewDecision, type ReviewItem } from './review-types';

/**
 * Corrects one extracted product before it is saved. Only the review copy changes; the menu is
 * untouched until the owner saves the import.
 */
export function EditDialog({
  item,
  org,
  jobId,
  categories,
  existingProducts,
  onClose,
}: {
  item: ReviewItem;
  org: string;
  jobId: string;
  categories: string[];
  existingProducts: { id: string; name: string }[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [state, formAction, pending] = useActionState(saveImportItemAction, initialActionState);
  const [decision, setDecision] = useState<ReviewDecision>(item.decision);
  // The photo is saved on its own (see PhotoPanel); the header shows the latest one.
  const [photo, setPhoto] = useState<string | null>(item.imageUrl);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  useEffect(() => {
    if (state.ok) ref.current?.close();
  }, [state]);

  const error = !state.ok && state.error ? (state.error === 'validation' ? 'Check the highlighted values.' : friendlyError(state.error)) : null;
  const fieldError = (k: string) => (!state.ok ? state.fieldErrors?.[k] : undefined);
  const priceLabel = item.platform ? `${SOURCE_LABEL[item.sourceType]} price` : 'Price';

  const choices: { v: ReviewDecision; label: string; hint: string }[] = [
    { v: 'CREATE', label: 'Import as a new dish', hint: 'Saved as a draft on your menu.' },
    { v: 'SKIP', label: 'Skip', hint: 'Not added to your menu.' },
    ...(item.mergeGroupKey ? [{ v: 'MERGE_WITH_IMPORTED' as const, label: 'Merge into the chosen version', hint: 'Same dish found in another source.' }] : []),
    ...(existingProducts.length ? [{ v: 'MERGE_INTO_EXISTING' as const, label: 'Link to a dish already on my menu', hint: 'Only its platform price is added as a reference.' }] : []),
  ];

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby="edit-item-title"
      className="m-auto max-h-[calc(100dvh-2rem)] w-[min(40rem,calc(100vw-2rem))] overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface p-0 text-ink shadow-2xl backdrop:bg-black/50 backdrop:backdrop-blur-[2px]"
      data-testid="edit-item-dialog"
    >
      {/* Header and buttons stay in view; only the fields scroll on short screens. */}
      <form onSubmit={keepValuesOnSubmit(formAction)} className="flex max-h-[calc(100dvh-2rem)] flex-col" data-testid="edit-item-form">
        <input type="hidden" name="org" value={org} />
        <input type="hidden" name="jobId" value={jobId} />
        <input type="hidden" name="importedProductId" value={item.id} />
        <input type="hidden" name="currentDecision" value={item.decision} />
        <input type="hidden" name="currentTargetProductId" value={item.targetProductId ?? ''} />

        <div className="flex shrink-0 items-start gap-4 border-b border-line px-5 py-4">
          <ProductThumb key={photo ?? 'none'} src={photo} size="md" />
          <div className="min-w-0 flex-1">
            <h2 id="edit-item-title" className="truncate text-base font-semibold">
              Edit product
            </h2>
            <p className="truncate text-sm text-muted">{item.name}</p>
            {item.available === false && <p className="mt-1 text-xs font-medium text-warning">Sold out on {SOURCE_LABEL[item.sourceType]} — saved as sold out</p>}
          </div>
          <button type="button" onClick={() => ref.current?.close()} className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-ink" aria-label="Close">
            <svg viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
              <path d="m5 5 10 10M15 5 5 15" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5">
          {error && <Alert tone="danger">{error}</Alert>}
          <fieldset className="rounded-xl border border-line p-3">
            <legend className="px-1 text-sm font-medium">Photo</legend>
            <PhotoPanel org={org} jobId={jobId} itemId={item.id} imageUrl={photo} sourceImageUrl={item.sourceImageUrl} sourceLabel={SOURCE_LABEL[item.sourceType] ?? 'the source'} onChanged={setPhoto} />
          </fieldset>
          <Field label="Name" htmlFor="edit-name" error={fieldError('name')}>
            <Input id="edit-name" name="name" defaultValue={item.name} required maxLength={120} data-testid="edit-name" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-[1fr_11rem]">
            <Field label="Category" htmlFor="edit-category">
              <Input id="edit-category" name="categoryName" defaultValue={item.categoryName ?? ''} maxLength={120} list="edit-categories" placeholder="e.g. Tajines" data-testid="edit-category" />
              <datalist id="edit-categories">
                {categories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </Field>
            <Field label={priceLabel} htmlFor="edit-price" error={fieldError('price')} hint={item.platform ? 'Reference only' : undefined}>
              <Input id="edit-price" name="price" defaultValue={centsToInputValue(item.priceCents)} inputMode="decimal" placeholder="16.90" className="tabular-nums" data-testid="edit-price" />
            </Field>
          </div>
          <Field label="Description" htmlFor="edit-description">
            <Textarea id="edit-description" name="description" defaultValue={item.description ?? ''} maxLength={1000} className="min-h-[72px]" />
          </Field>

          {(item.sizes.length > 0 || item.extras.length > 0) && (
            <div className="rounded-xl border border-line bg-surface-2/60 px-3 py-2.5 text-xs" data-testid="edit-options">
              {item.sizes.length > 0 && (
                <p>
                  <span className="font-medium">Sizes:</span>{' '}
                  {item.sizes.map((s) => `${s.name}${s.priceCents !== undefined ? ` (${formatCents(s.priceCents)})` : ''}`).join(' · ')}
                </p>
              )}
              {item.extras.map((g) => (
                <p key={g.name} className="mt-1">
                  <span className="font-medium">{g.name}</span> <span className="text-muted">({extrasRule(g)})</span>: {g.options.map((o) => `${o.name}${o.priceDeltaCents ? ` +${formatCents(o.priceDeltaCents)}` : ''}`).join(' · ')}
                </p>
              ))}
              {item.platform && <p className="mt-1.5 text-muted">Platform surcharges are shown for reference; your own option prices start at 0.</p>}
            </div>
          )}

          <fieldset>
            <legend className="mb-1.5 text-sm font-medium">What should happen to this product?</legend>
            <div className="space-y-1.5">
              {choices.map((c) => (
                <label key={c.v} className="flex cursor-pointer items-start gap-3 rounded-xl border border-line px-3 py-2 text-sm has-[:checked]:border-graphite has-[:checked]:bg-surface-2 dark:has-[:checked]:border-lime">
                  <input type="radio" name="decision" value={c.v} checked={decision === c.v} onChange={() => setDecision(c.v)} className="mt-1 accent-[#7ac70c]" />
                  <span>
                    <span className="block font-medium">{c.label}</span>
                    <span className="block text-xs text-muted">{c.hint}</span>
                  </span>
                </label>
              ))}
            </div>
            {decision === 'MERGE_INTO_EXISTING' && (
              <Select name="targetProductId" defaultValue={item.targetProductId ?? ''} aria-label="Dish on my menu" className="mt-2" required>
                <option value="">Choose the dish on your menu…</option>
                {existingProducts.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </Select>
            )}
          </fieldset>

          {item.warnings.length > 0 && (
            <ul className="space-y-0.5 text-xs text-warning">
              {item.warnings.map((w) => (
                <li key={w} className="flex items-start gap-1.5"><Icon name="alert" className="mt-0.5 size-3.5 shrink-0" />{w}</li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t border-line bg-surface px-5 py-3.5">
          <Button type="button" variant="secondary" onClick={() => ref.current?.close()}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending} data-testid="save-item">
            {pending ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
