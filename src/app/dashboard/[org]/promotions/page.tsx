import { ActionForm, FieldError } from '@/components/forms/action-form';
import { Badge, Card, CardBody, CardHeader, Checkbox, EmptyState, Field, Input, Label, PageHeader, Select, disclosureClass } from '@/components/ui';
import { getMessages } from '@/i18n';
import { centsToInputValue, formatCents } from '@/lib/money';
import { zonedParts } from '@/lib/time';
import { db } from '@/server/db';
import { pickName } from '@/server/services/menu';
import { listPromotions } from '@/server/services/promotions';
import { requireModulePage } from '@/server/module-page';
import { requireTenantPage } from '@/server/tenant';
import { savePromotionAction } from './actions';

const TYPE_LABEL = { PERCENTAGE: 'Percentage off', FIXED_AMOUNT: 'Fixed amount off', BUY_X_GET_Y: 'Buy X get Y free (e.g. 2×1)', COMBO: 'Combo price' } as const;
const CH = { TABLE: 'Table', TAKEAWAY: 'Takeaway', DELIVERY: 'Delivery' } as const;
/** datetime-local value of an instant, as wall-clock time in the restaurant's time zone (audit BUG-07). */
const dtIn = (tz: string) => (d: Date | null) => {
  if (!d) return '';
  const p = zonedParts(d, tz);
  const n = (x: number) => String(x).padStart(2, '0');
  return `${p.year}-${n(p.month)}-${n(p.day)}T${n(p.hour)}:${n(p.minute)}`;
};

type Promo = Awaited<ReturnType<typeof listPromotions>>[number];

export default async function PromotionsPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await requireTenantPage(org, 'promotions.manage');
  await requireModulePage(ctx, 'promotions');
  const m = getMessages(ctx.user.preferredLanguage);
  const [promos, products, categories, o] = await Promise.all([
    listPromotions(ctx),
    db.menuProduct.findMany({ where: { organizationId: ctx.org.id, status: { not: 'ARCHIVED' } }, include: { translations: true }, orderBy: { sortOrder: 'asc' } }),
    db.menuCategory.findMany({ where: { organizationId: ctx.org.id }, include: { translations: true }, orderBy: { sortOrder: 'asc' } }),
    db.restaurantOrganization.findUniqueOrThrow({ where: { id: ctx.org.id }, select: { sourceLanguage: true, enabledLanguages: true, locations: { select: { timeZone: true }, orderBy: { createdAt: 'asc' }, take: 1 } } }),
  ]);
  const timeZone = o.locations[0]?.timeZone ?? 'Europe/Lisbon';
  const dt = dtIn(timeZone);
  const langs = [o.sourceLanguage, ...o.enabledLanguages];

  // The type-specific fields (% off, € off, buy X / get Y, combo price) are shown only for the
  // chosen type, with CSS :has() in globals.css (.promo-fields) — no client JavaScript needed.
  const promoFields = (p?: Promo) => (
    <div className="promo-fields space-y-4">
      <input type="hidden" name="org" value={ctx.org.slug} />
      {p && <input type="hidden" name="id" value={p.id} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name shown to guests" htmlFor={`n-${p?.id ?? 'new'}`}><Input id={`n-${p?.id ?? 'new'}`} name="name" required defaultValue={p?.name} placeholder="e.g. Chá 2×1 à tarde" /><FieldError name="name" /></Field>
        <Field label="Type" htmlFor={`t-${p?.id ?? 'new'}`}>
          <Select id={`t-${p?.id ?? 'new'}`} name="type" defaultValue={p?.type ?? 'PERCENTAGE'}>
            {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div data-promo-field="PERCENTAGE"><Field label="% off" htmlFor={`pc-${p?.id ?? 'new'}`}><Input id={`pc-${p?.id ?? 'new'}`} name="percent" inputMode="decimal" defaultValue={p?.percentBasisPoints ? p.percentBasisPoints / 100 : ''} /><FieldError name="percent" /></Field></div>
        <div data-promo-field="FIXED_AMOUNT"><Field label="€ off" htmlFor={`am-${p?.id ?? 'new'}`}><Input id={`am-${p?.id ?? 'new'}`} name="amount" inputMode="decimal" defaultValue={centsToInputValue(p?.amountCents)} /><FieldError name="amount" /></Field></div>
        <div data-promo-field="BUY_X_GET_Y"><Field label="Buy X" htmlFor={`bx-${p?.id ?? 'new'}`}><Input id={`bx-${p?.id ?? 'new'}`} name="buyQuantity" type="number" min={1} defaultValue={p?.buyQuantity ?? ''} /><FieldError name="buyQuantity" /></Field></div>
        <div data-promo-field="BUY_X_GET_Y"><Field label="Get Y free" htmlFor={`gy-${p?.id ?? 'new'}`}><Input id={`gy-${p?.id ?? 'new'}`} name="getQuantity" type="number" min={1} defaultValue={p?.getQuantity ?? ''} /></Field></div>
        <div data-promo-field="COMBO"><Field label="Combo €" htmlFor={`cp-${p?.id ?? 'new'}`}><Input id={`cp-${p?.id ?? 'new'}`} name="comboPrice" inputMode="decimal" defaultValue={centsToInputValue(p?.comboPriceCents)} /></Field></div>
      </div>
      {/* Checkbox lists instead of multi-selects: no Ctrl-click, and easy to use with a thumb. */}
      <div className="grid gap-3 sm:grid-cols-2">
        <fieldset className="min-w-0">
          <legend className="mb-1.5 text-sm font-medium text-ink">Dishes <span className="font-normal text-muted">(none = all; combo = the dishes in the combo)</span></legend>
          <div className="mn-scroll max-h-44 space-y-px overflow-y-auto rounded-lg border border-line bg-surface p-1">
            {products.map((x) => (
              <label key={x.id} className="flex min-h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-sm hover:bg-surface-2 has-checked:bg-accent-soft/60 pointer-coarse:min-h-10">
                <input type="checkbox" name="productIds" value={x.id} defaultChecked={p?.productIds.includes(x.id)} className="size-4 shrink-0 accent-[#6cb30a]" />
                <span className="min-w-0 truncate">{pickName(x.translations, langs)}</span>
              </label>
            ))}
          </div>
          <FieldError name="productIds" />
        </fieldset>
        <fieldset className="min-w-0">
          <legend className="mb-1.5 text-sm font-medium text-ink">Categories <span className="font-normal text-muted">(none = all)</span></legend>
          <div className="mn-scroll max-h-44 space-y-px overflow-y-auto rounded-lg border border-line bg-surface p-1">
            {categories.map((x) => (
              <label key={x.id} className="flex min-h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-sm hover:bg-surface-2 has-checked:bg-accent-soft/60 pointer-coarse:min-h-10">
                <input type="checkbox" name="categoryIds" value={x.id} defaultChecked={p?.categoryIds.includes(x.id)} className="size-4 shrink-0 accent-[#6cb30a]" />
                <span className="min-w-0 truncate">{pickName(x.translations, langs)}</span>
              </label>
            ))}
          </div>
        </fieldset>
      </div>
      <div>
        <Label>Channels</Label>
        <div className="flex flex-wrap gap-x-5 gap-y-1">
          {(Object.keys(CH) as (keyof typeof CH)[]).map((c) => <Checkbox key={c} name="channels" value={c} label={CH[c]} defaultChecked={p ? p.channels.includes(c) : true} />)}
        </div>
        <FieldError name="channels" />
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Minimum order €" htmlFor={`mo-${p?.id ?? 'new'}`} optionalLabel="opt."><Input id={`mo-${p?.id ?? 'new'}`} name="minOrder" inputMode="decimal" defaultValue={p?.minOrderCents ? centsToInputValue(p.minOrderCents) : ''} /></Field>
        <Field label="Total uses" htmlFor={`ul-${p?.id ?? 'new'}`} optionalLabel="opt."><Input id={`ul-${p?.id ?? 'new'}`} name="usageLimit" type="number" min={1} defaultValue={p?.usageLimit ?? ''} /></Field>
        <Field label="Starts" htmlFor={`sa-${p?.id ?? 'new'}`} optionalLabel="opt." hint={`Restaurant time (${timeZone})`}><Input id={`sa-${p?.id ?? 'new'}`} name="startsAt" type="datetime-local" defaultValue={dt(p?.startsAt ?? null)} /></Field>
        <Field label="Ends" htmlFor={`ea-${p?.id ?? 'new'}`} optionalLabel="opt." hint={`Restaurant time (${timeZone})`}><Input id={`ea-${p?.id ?? 'new'}`} name="endsAt" type="datetime-local" defaultValue={dt(p?.endsAt ?? null)} /><FieldError name="endsAt" /></Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Promo code" htmlFor={`cc-${p?.id ?? 'new'}`} optionalLabel="empty = automatic"><Input id={`cc-${p?.id ?? 'new'}`} name="couponCode" className="uppercase" defaultValue={p?.coupons[0]?.code ?? ''} /></Field>
        <Field label="Code uses" htmlFor={`cl-${p?.id ?? 'new'}`} optionalLabel="opt."><Input id={`cl-${p?.id ?? 'new'}`} name="couponLimit" type="number" min={1} defaultValue={p?.coupons[0]?.usageLimit ?? ''} /></Field>
        <Field label="Priority (higher first)" htmlFor={`pi-${p?.id ?? 'new'}`}><Input id={`pi-${p?.id ?? 'new'}`} name="priority" type="number" min={0} max={100} defaultValue={p?.priority ?? 0} /></Field>
      </div>
      <div className="flex flex-wrap gap-6">
        <Checkbox name="combinable" label="Can be combined with other combinable promotions" defaultChecked={p?.combinable ?? false} />
        <Checkbox name="isActive" label="Active" defaultChecked={p?.isActive ?? true} />
      </div>
    </div>
  );

  const summary = (p: Promo) =>
    p.type === 'PERCENTAGE' ? `${(p.percentBasisPoints ?? 0) / 100} % off` : p.type === 'FIXED_AMOUNT' ? `${formatCents(p.amountCents ?? 0)} off` : p.type === 'BUY_X_GET_Y' ? `Buy ${p.buyQuantity} get ${p.getQuantity} free` : `Combo ${formatCents(p.comboPriceCents ?? 0)}`;

  return (
    <>
      <PageHeader title={m.nav.promotions} description="Optional discounts. Guests see the saving in their cart and on their order. Totals never go below zero and a euro is never discounted twice." />
            <div className="grid gap-6 xl:grid-cols-[1fr_520px]">
        <Card>
          <CardHeader icon="tag" title={`Promotions (${promos.length})`} />
          {promos.length === 0 ? (
            <CardBody><EmptyState icon="tag" title="No promotions yet" description="Create one with the form. It applies automatically to matching orders." /></CardBody>
          ) : (
            <ul className="divide-y divide-line">
              {promos.map((p) => (
                <li key={p.id} className="px-4 py-3.5 sm:px-5" data-testid="promotion">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{p.name}</span>
                    <span className="flex flex-wrap gap-1.5">
                      <Badge tone={p.isActive ? 'success' : 'neutral'} dot>{p.isActive ? 'Active' : 'Off'}</Badge>
                      <Badge>{summary(p)}</Badge>
                      {p.coupons[0] && <Badge tone="dark">Code {p.coupons[0].code}</Badge>}
                      <Badge>{p._count.orderDiscounts} uses{p.usageLimit ? ` / ${p.usageLimit}` : ''}</Badge>
                    </span>
                  </div>
                  <details className="mt-2">
                    <summary className={disclosureClass}>Edit</summary>
                    <ActionForm action={savePromotionAction} submitLabel="Save promotion" submitVariant="secondary" className="mt-3">
                      {promoFields(p)}
                    </ActionForm>
                  </details>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="xl:sticky xl:top-20 xl:max-h-[calc(100dvh-6rem)] xl:overflow-y-auto">
          <CardHeader icon="plus" title="New promotion" />
          <CardBody>
            <ActionForm action={savePromotionAction} submitLabel="Create promotion" resetOnSuccess testId="promotion-form">
              {promoFields()}
            </ActionForm>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
