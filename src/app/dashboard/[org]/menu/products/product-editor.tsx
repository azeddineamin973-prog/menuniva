'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ActionForm } from '@/components/forms/action-form';
import { Alert, Badge, Card, CardBody, CardHeader, Checkbox, Field, Icon, Input, Select, Textarea } from '@/components/ui';
import type { LanguageCode } from '@/generated/prisma/enums';
import { LANGUAGE_NATIVE_NAME } from '@/i18n/config';
import { cn } from '@/lib/cn';
import { saveProductAction } from '../actions';

type T = { name: string; description: string; ingredients: string };
export type ProductEditorValue = {
  id?: string;
  categoryId: string;
  stationId: string | null;
  taxClassId: string | null;
  status: 'DRAFT' | 'ACTIVE';
  isFeatured: boolean;
  isPopular: boolean;
  tags: string[];
  translations: Partial<Record<LanguageCode, T>>;
  prices: { DINE_IN: string; TAKEAWAY: string; DELIVERY: string };
};

export function ProductEditor({
  org,
  base,
  initial,
  categories,
  stations,
  taxClasses = [],
  sourceLanguage,
  languages,
}: {
  org: string;
  base: string;
  initial: ProductEditorValue;
  categories: { id: string; name: string; defaultStation: string | null }[];
  stations: { id: string; name: string }[];
  taxClasses?: { id: string; name: string }[];
  sourceLanguage: LanguageCode;
  languages: LanguageCode[];
}) {
  const router = useRouter();
  const [v, setV] = useState<ProductEditorValue>(initial);
  const [tab, setTab] = useState<LanguageCode>(sourceLanguage);
  const ordered = [sourceLanguage, ...languages.filter((l) => l !== sourceLanguage)];
  const tr = (l: LanguageCode): T => v.translations[l] ?? { name: '', description: '', ingredients: '' };
  const setTr = (l: LanguageCode, patch: Partial<T>) => setV({ ...v, translations: { ...v.translations, [l]: { ...tr(l), ...patch } } });
  const cat = categories.find((c) => c.id === v.categoryId);

  const payload = JSON.stringify({
    ...v,
    id: v.id,
    stationId: v.stationId || null,
    taxClassId: v.taxClassId || null,
    translations: Object.fromEntries(ordered.map((l) => [l, tr(l)])),
  });

  return (
    <ActionForm
      action={saveProductAction}
      submitLabel={v.id ? 'Save dish' : 'Create dish'}
      testId="product-form"
      stickySubmit
      onSuccess={(data) => {
        const id = (data as { id?: string } | undefined)?.id;
        if (!v.id && id) router.push(`${base}/menu/products/${id}`);
        else router.refresh();
      }}
    >
      <input type="hidden" name="org" value={org} />
      <input type="hidden" name="payload" value={payload} />
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader icon="edit" title="Name & description" description="Write in your source language first. Other languages show “Translation required” until you fill them." />
          <div className="mn-scroll flex gap-1 overflow-x-auto border-b border-line px-3 pt-1" role="tablist" aria-label="Languages">
            {ordered.map((l) => {
              const filled = !!tr(l).name.trim();
              return (
                <button
                  key={l}
                  type="button"
                  onClick={() => setTab(l)}
                  role="tab"
                  aria-selected={tab === l}
                  className={cn('-mb-px inline-flex min-h-10 shrink-0 items-center gap-1.5 border-b-2 px-2.5 text-sm whitespace-nowrap transition-colors pointer-coarse:min-h-11', tab === l ? 'border-ink font-medium text-ink dark:border-lime' : 'border-transparent text-muted hover:text-ink')}
                  data-testid={`lang-tab-${l}`}
                >
                  {LANGUAGE_NATIVE_NAME[l]} {l === sourceLanguage ? <Badge tone="dark">source</Badge> : filled ? <Icon name="check" className="size-3.5 text-success" /> : <span className="size-1.5 rounded-full bg-warning" title="Translation required" />}
                </button>
              );
            })}
          </div>
          <CardBody className="space-y-4" dir={tab === 'ar' ? 'rtl' : 'ltr'}>
            {tab !== sourceLanguage && !tr(tab).name.trim() && <Alert tone="warning">Translation required — guests reading {LANGUAGE_NATIVE_NAME[tab]} will see the {LANGUAGE_NATIVE_NAME[sourceLanguage]} text.</Alert>}
            <Field label={`Dish name (${LANGUAGE_NATIVE_NAME[tab]})`} htmlFor={`name-${tab}`}>
              <Input id={`name-${tab}`} value={tr(tab).name} maxLength={120} onChange={(e) => setTr(tab, { name: e.target.value })} required={tab === sourceLanguage} data-testid={`product-name-${tab}`} />
            </Field>
            <Field label="Description" htmlFor={`desc-${tab}`} optionalLabel="optional">
              <Textarea id={`desc-${tab}`} value={tr(tab).description} maxLength={1000} onChange={(e) => setTr(tab, { description: e.target.value })} />
            </Field>
            <Field label="Ingredients" htmlFor={`ing-${tab}`} optionalLabel="optional" hint="Write only what you have confirmed. Allergens are declared separately below.">
              <Textarea id={`ing-${tab}`} value={tr(tab).ingredients} maxLength={1000} onChange={(e) => setTr(tab, { ingredients: e.target.value })} />
            </Field>
          </CardBody>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader icon="tag" title="Prices (EUR, VAT included)" description="Set by you. Imported Glovo/Uber prices never change these." />
            <CardBody className="space-y-3">
              {(
                [
                  ['DINE_IN', 'Dine-in (table)'],
                  ['TAKEAWAY', 'Takeaway'],
                  ['DELIVERY', 'Delivery'],
                ] as const
              ).map(([ch, label]) => (
                <Field key={ch} label={label} htmlFor={`price-${ch}`} optionalLabel={ch === 'DINE_IN' ? undefined : 'optional'}>
                  <div className="relative">
                    <Input
                      id={`price-${ch}`}
                      inputMode="decimal"
                      placeholder="0,00"
                      value={v.prices[ch]}
                      onChange={(e) => setV({ ...v, prices: { ...v.prices, [ch]: e.target.value } })}
                      className="pe-9 tabular-nums"
                      data-testid={`price-${ch}`}
                    />
                    <span className="pointer-events-none absolute inset-y-0 end-3 flex items-center text-sm text-muted" aria-hidden>
                      €
                    </span>
                  </div>
                </Field>
              ))}
              <p className="text-xs text-muted">Leave takeaway or delivery empty to not offer the dish on that channel.</p>
            </CardBody>
          </Card>
          <Card>
            <CardHeader icon="layers" title="Placement & visibility" />
            <CardBody className="space-y-4">
              <Field label="Category" htmlFor="categoryId">
                <Select id="categoryId" value={v.categoryId} onChange={(e) => setV({ ...v, categoryId: e.target.value })}>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </Field>
              <Field label="Preparation station" htmlFor="stationId" hint={`Category default: ${cat?.defaultStation ?? 'none'}`}>
                <Select id="stationId" value={v.stationId ?? ''} onChange={(e) => setV({ ...v, stationId: e.target.value || null })} data-testid="product-station">
                  <option value="">Use category default</option>
                  {stations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </Select>
              </Field>
              {taxClasses.length > 0 && (
                <Field label="VAT class" htmlFor="taxClassId" hint="Approved by you in Settings → Tax. Prices above already include VAT.">
                  <Select id="taxClassId" value={v.taxClassId ?? ''} onChange={(e) => setV({ ...v, taxClassId: e.target.value || null })}>
                    <option value="">— not set —</option>
                    {taxClasses.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </Select>
                </Field>
              )}
              <Field label="Tags" htmlFor="tags" optionalLabel="comma separated" hint="e.g. vegetarian, spicy — only if true.">
                <Input id="tags" value={v.tags.join(', ')} onChange={(e) => setV({ ...v, tags: e.target.value.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 15) })} />
              </Field>
              <Checkbox label="Featured" checked={v.isFeatured} onChange={(e) => setV({ ...v, isFeatured: e.target.checked })} />
              <Checkbox label="Popular" checked={v.isPopular} onChange={(e) => setV({ ...v, isPopular: e.target.checked })} />
              <Field label="Visibility" htmlFor="status">
                <Select id="status" value={v.status} onChange={(e) => setV({ ...v, status: e.target.value as 'DRAFT' | 'ACTIVE' })} data-testid="product-status">
                  <option value="DRAFT">Draft — not visible to guests</option>
                  <option value="ACTIVE">Visible on the menu</option>
                </Select>
              </Field>
            </CardBody>
          </Card>
        </div>
      </div>
    </ActionForm>
  );
}
