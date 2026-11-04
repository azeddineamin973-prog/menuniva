'use client';

import { useState } from 'react';
import { fmt } from '@/i18n/config';
import { cn } from '@/lib/cn';
import { uuid } from '@/lib/uuid';
import type { PublicProduct } from '@/server/services/public-menu';
import { Icon } from '@/components/ui/icons';
import { MediaImage } from '@/components/ui/media-image';
import type { CartLine } from './cart';
import type { Msg } from './cart-sheet';
import { CloseButton, Sheet } from './sheet';
import { sfButton, SF_INPUT, Stepper } from './ui';

/**
 * One dish: photo, name, price, description, then its choices and the Add bar.
 * Phones: a bottom sheet. Desktop: a two-column dialog (photo | details).
 * Required choices are marked and checked before adding; the server checks them again.
 */
export function ProductSheet({
  product: p,
  m,
  money,
  canOrder,
  orderActions = [],
  onClose,
  onAdd,
}: {
  product: PublicProduct;
  m: Msg;
  money: (c: number) => string;
  canOrder: boolean;
  /** Browse-only page: the ways to order this dish instead of an Add button. */
  orderActions?: { label: string; href: string; icon?: 'bag' | 'truck' }[];
  onClose: () => void;
  onAdd: (l: CartLine) => void;
}) {
  const c = m.customer;
  const [variantId, setVariantId] = useState<string | null>(p.variants.find((v) => v.isDefault)?.id ?? p.variants[0]?.id ?? null);
  const [qty, setQty] = useState(1);
  const [notes, setNotes] = useState('');
  const [showNotes, setShowNotes] = useState(false);
  const [sel, setSel] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const variant = p.variants.find((v) => v.id === variantId);
  const modsUnit = p.modifierGroups.flatMap((g) => g.options).reduce((s, o) => s + (sel[o.id] ?? 0) * o.priceDeltaCents, 0);
  const unit = p.priceCents + (variant?.priceDeltaCents ?? 0) + modsUnit;

  const toggle = (groupId: string, optionId: string) => {
    setError(null);
    const g = p.modifierGroups.find((x) => x.id === groupId)!;
    const inGroup = g.options.reduce((n, o) => n + (sel[o.id] ?? 0), 0);
    setSel((s) => {
      const cur = s[optionId] ?? 0;
      if (g.maxSelect === 1) {
        const next = { ...s };
        g.options.forEach((o) => delete next[o.id]);
        if (!cur) next[optionId] = 1;
        return next;
      }
      if (cur) {
        const next = { ...s };
        delete next[optionId];
        return next;
      }
      if (inGroup >= g.maxSelect) return s;
      return { ...s, [optionId]: 1 };
    });
  };

  const add = () => {
    for (const g of p.modifierGroups) {
      const n = g.options.reduce((k, o) => k + (sel[o.id] ?? 0), 0);
      if (n < g.minSelect || n > g.maxSelect) {
        setError(fmt(m.validation.chooseOption, { group: g.name }));
        document.getElementById(`group-${g.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
    }
    const chosen = p.modifierGroups.flatMap((g) => g.options.filter((o) => sel[o.id]).map((o) => o.name));
    onAdd({
      lineId: uuid(),
      productId: p.id,
      variantId,
      modifiers: Object.entries(sel).map(([optionId, quantity]) => ({ optionId, quantity })),
      quantity: qty,
      notes: notes.trim(),
      name: p.name,
      detail: [variant?.name, ...chosen].filter(Boolean).join(' · '),
      unitCents: unit,
    });
  };

  const allergenList = (codes: string[]) => codes.map((x) => m.allergens[x as keyof Msg['allergens']]).join(', ');
  const allergenText = p.allergens
    ? [p.allergens.contains.length ? fmt(c.containsAllergens, { list: allergenList(p.allergens.contains) }) : '', p.allergens.mayContain.length ? fmt(c.mayContain, { list: allergenList(p.allergens.mayContain) }) : ''].filter(Boolean).join(' · ') || '—'
    : c.allergenInfoNotVerified;
  const rule = (g: PublicProduct['modifierGroups'][number]) => (g.maxSelect === 1 ? c.chooseOne : g.minSelect > 0 ? fmt(c.chooseBetween, { min: g.minSelect, max: g.maxSelect }) : fmt(c.chooseUpTo, { n: g.maxSelect }));

  return (
    <Sheet onClose={onClose} label={p.name} closeLabel={m.common.close} wide testId="product-sheet">
      <div className="sticky top-0 z-20 h-0 lg:absolute lg:inset-x-0">
        <CloseButton onClick={onClose} label={m.common.close} className="absolute end-3 top-3" />
      </div>
      <div className="lg:grid lg:h-[min(44rem,88dvh)] lg:grid-cols-[1.05fr_1fr]">
        {p.imageUrl ? (
          <div className="relative overflow-hidden bg-sf-sunken lg:h-full">
            <MediaImage
              src={p.imageUrl}
              sizes="(min-width: 1024px) 460px, (min-width: 640px) 576px, 100vw"
              widths={[480, 640, 960, 1280]}
              phoneWidths={[480, 640, 960]}
              className="aspect-[4/3] max-h-[21rem] w-full object-cover sm:aspect-[16/10] lg:absolute lg:inset-0 lg:aspect-auto lg:h-full lg:max-h-none"
              decoding="async"
            />
          </div>
        ) : (
          <div className="h-4 lg:hidden" aria-hidden />
        )}
        <div className="flex flex-col lg:min-h-0">
          <div className={cn('flex-1 space-y-6 px-5 pt-5 pb-6 sm:px-6 lg:overflow-y-auto lg:px-7 lg:pt-7', !p.imageUrl && 'pe-14')}>
            <div>
              {p.isPopular && (
                <p className="mb-1.5 inline-flex items-center gap-1 text-[11px] font-semibold tracking-wide text-sf-gold uppercase">
                  <Icon name="star" className="size-3" />
                  {c.popular}
                </p>
              )}
              <h2 className="font-serif text-[1.75rem] leading-tight">{p.name}</h2>
              <p className="mt-1.5 text-lg font-semibold tabular-nums">{money(p.priceCents + (variant?.priceDeltaCents ?? 0))}</p>
              {p.description && <p className="mt-3 leading-relaxed text-sf-muted">{p.description}</p>}
              {p.ingredients && <p className="mt-2 text-sm text-sf-muted">{p.ingredients}</p>}
              {p.tags.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {p.tags.map((t) => (
                    <span key={t} className="rounded-full bg-sf-sunken px-2.5 py-1 text-xs font-medium capitalize">
                      {t}
                    </span>
                  ))}
                </div>
              )}
              <p className="mt-4 flex items-start gap-2 text-[13px] text-sf-muted" data-testid="dish-allergens">
                <Icon name="info" className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  <span className="font-medium text-sf-text">{c.allergens}:</span> {allergenText}
                </span>
              </p>
            </div>

            {p.variants.length > 0 && (
              <OptionGroup title={c.chooseOne} required requiredLabel={c.requiredChoice}>
                {p.variants.map((v) => (
                  <OptionRow key={v.id} type="radio" name="variant" checked={variantId === v.id} onChange={() => setVariantId(v.id)} label={v.name} price={money(p.priceCents + v.priceDeltaCents)} />
                ))}
              </OptionGroup>
            )}
            {p.modifierGroups.map((g) => (
              <OptionGroup key={g.id} id={`group-${g.id}`} title={g.name} rule={rule(g)} required={g.minSelect > 0} requiredLabel={c.requiredChoice} invalid={!!error && error.includes(g.name)}>
                {g.options.map((o) => (
                  <OptionRow key={o.id} type={g.maxSelect === 1 ? 'radio' : 'checkbox'} name={`g-${g.id}`} checked={!!sel[o.id]} onChange={() => toggle(g.id, o.id)} label={o.name} price={o.priceDeltaCents !== 0 ? `${o.priceDeltaCents > 0 ? '+' : ''}${money(o.priceDeltaCents)}` : undefined} />
                ))}
              </OptionGroup>
            ))}

            {canOrder &&
              (showNotes || notes ? (
                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium">
                    {c.notesForKitchen} <span className="font-normal text-sf-muted">({m.common.optional})</span>
                  </span>
                  <textarea autoFocus={showNotes && !notes} value={notes} onChange={(e) => setNotes(e.target.value.slice(0, 200))} placeholder={c.notesPlaceholder} rows={2} className={cn(SF_INPUT, 'h-auto py-3')} />
                </label>
              ) : (
                <button type="button" onClick={() => setShowNotes(true)} className="-ms-1 inline-flex min-h-11 items-center gap-2 rounded-full px-1 text-[15px] font-medium text-sf-primary-ink hover:underline" data-testid="add-kitchen-note">
                  <Icon name="edit" className="size-4" />
                  {c.notesForKitchen}
                </button>
              ))}
          </div>

          {canOrder ? (
            <div className="sticky bottom-0 z-10 space-y-2 border-t border-sf-line bg-sf-bg/95 px-5 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur sm:px-6 lg:px-7">
              {error && (
                <p className="text-sm font-medium text-red-700" role="alert">
                  {error}
                </p>
              )}
              <div className="flex items-center gap-3">
                <Stepper value={qty} onChange={setQty} labels={{ minus: '−', plus: '+', quantity: c.quantity }} />
                <button type="button" disabled={p.soldOut} onClick={add} className={sfButton('primary', 'lg', 'min-w-0 flex-1 justify-between gap-3 px-5')} data-testid="add-to-cart">
                  <span className="truncate">{m.common.add}</span>
                  <span className="shrink-0 tabular-nums">{money(unit * qty)}</span>
                </button>
              </div>
            </div>
          ) : (
            orderActions.length > 0 && (
              <div className="sticky bottom-0 z-10 space-y-2 border-t border-sf-line bg-sf-bg/95 px-5 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur sm:px-6 lg:px-7" data-testid="sheet-order-actions">
                <p className="text-sm font-medium text-sf-muted">{c.howToOrder}</p>
                <div className={cn('grid gap-2', orderActions.length > 1 && 'grid-cols-2')}>
                  {orderActions.map((a) => (
                    <a key={a.href} href={a.href} className={sfButton('primary', 'md', 'w-full px-3')}>
                      {a.icon && <Icon name={a.icon} className="size-[18px]" />}
                      <span className="truncate">{a.label}</span>
                    </a>
                  ))}
                </div>
              </div>
            )
          )}
        </div>
      </div>
    </Sheet>
  );
}

function OptionGroup({ id, title, rule, required, requiredLabel, invalid, children }: { id?: string; title: string; rule?: string; required?: boolean; requiredLabel: string; invalid?: boolean; children: React.ReactNode }) {
  return (
    <fieldset id={id} className="scroll-mt-6">
      <legend className="mb-2.5 flex w-full items-center justify-between gap-3">
        <span>
          <span className="block text-[17px] font-semibold">{title}</span>
          {rule && <span className="text-[13px] text-sf-muted">{rule}</span>}
        </span>
        {required && <span className={cn('rounded-full px-2.5 py-1 text-xs font-semibold', invalid ? 'bg-red-100 text-red-800' : 'bg-sf-sunken text-sf-muted')}>{requiredLabel}</span>}
      </legend>
      <div className={cn('divide-y divide-sf-line overflow-hidden rounded-2xl bg-sf-card ring-1', invalid ? 'ring-red-300' : 'ring-sf-line')}>{children}</div>
    </fieldset>
  );
}

function OptionRow({ type, name, checked, onChange, label, price }: { type: 'radio' | 'checkbox'; name: string; checked: boolean; onChange: () => void; label: string; price?: string }) {
  return (
    <label className={cn('flex min-h-14 cursor-pointer items-center gap-3 px-4 py-3 transition-colors', checked ? 'bg-sf-soft' : 'hover:bg-sf-sunken')}>
      <input type={type} name={name} checked={checked} onChange={onChange} className="size-5 shrink-0 accent-[var(--sf-primary)]" />
      <span className={cn('flex-1 text-[15px]', checked && 'font-medium')}>{label}</span>
      {price && <span className="text-sm text-sf-muted tabular-nums">{price}</span>}
    </label>
  );
}
