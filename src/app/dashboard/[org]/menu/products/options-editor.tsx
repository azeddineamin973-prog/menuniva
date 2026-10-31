'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ActionForm } from '@/components/forms/action-form';
import { Button, Card, CardBody, CardHeader, Checkbox, Input } from '@/components/ui';
import type { LanguageCode } from '@/generated/prisma/enums';
import { LANGUAGE_NATIVE_NAME } from '@/i18n/config';
import { saveOptionsAction } from '../actions';

type Names = Partial<Record<LanguageCode, string>>;
type Variant = { names: Names; priceDelta: string; isDefault: boolean; isAvailable: boolean };
type Option = { names: Names; priceDelta: string; maxQuantity: number; isAvailable: boolean };
type Group = { names: Names; minSelect: number; maxSelect: number; options: Option[] };

function NamesInput({ names, onChange, languages, source, placeholder }: { names: Names; onChange: (n: Names) => void; languages: LanguageCode[]; source: LanguageCode; placeholder: string }) {
  const [open, setOpen] = useState(false);
  const others = languages.filter((l) => l !== source);
  return (
    <div className="min-w-0 flex-1">
      <Input value={names[source] ?? ''} placeholder={`${placeholder} (${LANGUAGE_NATIVE_NAME[source]})`} onChange={(e) => onChange({ ...names, [source]: e.target.value })} />
      {others.length > 0 && (
        <button type="button" className="mt-1 inline-flex min-h-8 items-center rounded-lg px-1 text-xs text-muted underline-offset-2 hover:text-ink hover:underline pointer-coarse:min-h-10" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? 'Hide translations' : `Translations (${others.filter((l) => names[l]?.trim()).length}/${others.length})`}
        </button>
      )}
      {open && (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {others.map((l) => (
            <Input key={l} dir={l === 'ar' ? 'rtl' : 'ltr'} value={names[l] ?? ''} placeholder={LANGUAGE_NATIVE_NAME[l]} onChange={(e) => onChange({ ...names, [l]: e.target.value })} className="h-9" />
          ))}
        </div>
      )}
    </div>
  );
}

export function OptionsEditor({ org, productId, languages, source, initial }: { org: string; productId: string; languages: LanguageCode[]; source: LanguageCode; initial: { variants: Variant[]; groups: Group[] } }) {
  const router = useRouter();
  const [variants, setVariants] = useState<Variant[]>(initial.variants);
  const [groups, setGroups] = useState<Group[]>(initial.groups);
  const updGroup = (i: number, patch: Partial<Group>) => setGroups(groups.map((g, j) => (j === i ? { ...g, ...patch } : g)));
  return (
    <ActionForm action={saveOptionsAction} submitLabel="Save sizes & extras" onSuccess={() => router.refresh()} testId="options-form">
      <input type="hidden" name="org" value={org} />
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="payload" value={JSON.stringify({ variants, groups })} />
      <Card>
        <CardHeader title="Sizes / variants" description="Optional. The extra price is added to the channel price (use 0 for the base size, or a negative value for a smaller size)." />
        <CardBody className="space-y-3">
          {variants.map((v, i) => (
            <div key={i} className="flex flex-wrap items-start gap-2 rounded-xl border border-line p-3">
              <NamesInput names={v.names} languages={languages} source={source} placeholder="Size name" onChange={(names) => setVariants(variants.map((x, j) => (j === i ? { ...x, names } : x)))} />
              <Input className="w-28" inputMode="decimal" value={v.priceDelta} aria-label="Extra price" placeholder="+0,00" onChange={(e) => setVariants(variants.map((x, j) => (j === i ? { ...x, priceDelta: e.target.value } : x)))} />
              <Checkbox label="Default" checked={v.isDefault} onChange={(e) => setVariants(variants.map((x, j) => ({ ...x, isDefault: j === i ? e.target.checked : false })))} />
              <Checkbox label="Available" checked={v.isAvailable} onChange={(e) => setVariants(variants.map((x, j) => (j === i ? { ...x, isAvailable: e.target.checked } : x)))} />
              <Button type="button" variant="ghost" size="sm" onClick={() => setVariants(variants.filter((_, j) => j !== i))}>Remove</Button>
            </div>
          ))}
          <Button type="button" variant="secondary" size="sm" onClick={() => setVariants([...variants, { names: {}, priceDelta: '0', isDefault: variants.length === 0, isAvailable: true }])}>
            + Add size
          </Button>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Extras & choices (modifier groups)" description="e.g. “Choose a side” (min 1, max 1 = required single choice) or “Extras” (min 0, max 3 = optional)." />
        <CardBody className="space-y-4">
          {groups.map((g, i) => (
            <div key={i} className="space-y-3 rounded-xl border border-line p-3">
              <div className="flex flex-wrap items-start gap-2">
                <NamesInput names={g.names} languages={languages} source={source} placeholder="Group name" onChange={(names) => updGroup(i, { names })} />
                <label className="flex items-center gap-1 text-sm">
                  Min <Input type="number" min={0} max={20} className="w-16" value={g.minSelect} onChange={(e) => updGroup(i, { minSelect: Number(e.target.value) })} />
                </label>
                <label className="flex items-center gap-1 text-sm">
                  Max <Input type="number" min={1} max={20} className="w-16" value={g.maxSelect} onChange={(e) => updGroup(i, { maxSelect: Number(e.target.value) })} />
                </label>
                <Button type="button" variant="ghost" size="sm" onClick={() => setGroups(groups.filter((_, j) => j !== i))}>Remove group</Button>
              </div>
              <p className="text-xs text-muted">{g.minSelect > 0 ? `Required: guest must choose at least ${g.minSelect}.` : 'Optional.'}</p>
              <div className="space-y-2 ps-3">
                {g.options.map((o, k) => (
                  <div key={k} className="flex flex-wrap items-start gap-2">
                    <NamesInput names={o.names} languages={languages} source={source} placeholder="Option" onChange={(names) => updGroup(i, { options: g.options.map((x, m) => (m === k ? { ...x, names } : x)) })} />
                    <Input className="w-28" inputMode="decimal" value={o.priceDelta} aria-label="Extra price" placeholder="+0,00" onChange={(e) => updGroup(i, { options: g.options.map((x, m) => (m === k ? { ...x, priceDelta: e.target.value } : x)) })} />
                    <label className="flex items-center gap-1 text-sm">
                      Max qty <Input type="number" min={1} max={20} className="w-16" value={o.maxQuantity} onChange={(e) => updGroup(i, { options: g.options.map((x, m) => (m === k ? { ...x, maxQuantity: Number(e.target.value) } : x)) })} />
                    </label>
                    <Checkbox label="Available" checked={o.isAvailable} onChange={(e) => updGroup(i, { options: g.options.map((x, m) => (m === k ? { ...x, isAvailable: e.target.checked } : x)) })} />
                    <Button type="button" variant="ghost" size="sm" onClick={() => updGroup(i, { options: g.options.filter((_, m) => m !== k) })}>✕</Button>
                  </div>
                ))}
                <Button type="button" variant="secondary" size="sm" onClick={() => updGroup(i, { options: [...g.options, { names: {}, priceDelta: '0', maxQuantity: 1, isAvailable: true }] })}>
                  + Add option
                </Button>
              </div>
            </div>
          ))}
          <Button type="button" variant="secondary" size="sm" onClick={() => setGroups([...groups, { names: {}, minSelect: 0, maxSelect: 1, options: [{ names: {}, priceDelta: '0', maxQuantity: 1, isAvailable: true }] }])}>
            + Add group
          </Button>
        </CardBody>
      </Card>
    </ActionForm>
  );
}
