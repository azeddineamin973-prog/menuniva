import { ActionForm, FieldError } from '@/components/forms/action-form';
import { Alert, Badge, Card, CardBody, CardHeader, Checkbox, Field, Input, Label, PageHeader, Select } from '@/components/ui';
import { getMessages } from '@/i18n';
import { centsToInputValue, formatCents } from '@/lib/money';
import { db } from '@/server/db';
import { pickName } from '@/server/services/menu';
import { listPromotions } from '@/server/services/promotions';
import { requireModulePage } from '@/server/modules';
import { requireTenantPage } from '@/server/tenant';
import { savePromotionAction } from './actions';

const TYPE_LABEL = { PERCENTAGE: 'Percentage off', FIXED_AMOUNT: 'Fixed amount off', BUY_X_GET_Y: 'Buy X get Y free (e.g. 2×1)', COMBO: 'Combo price' } as const;
const CH = { TABLE: 'Table', TAKEAWAY: 'Takeaway', DELIVERY: 'Delivery' } as const;
const dt = (d: Date | null) => (d ? new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '');

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
    db.restaurantOrganization.findUniqueOrThrow({ where: { id: ctx.org.id }, select: { sourceLanguage: true, enabledLanguages: true } }),
  ]);
  const langs = [o.sourceLanguage, ...o.enabledLanguages];

  const PromoFields = ({ p }: { p?: Promo }) => (
    <>
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
      <div className="grid gap-3 sm:grid-cols-5">
        <Field label="% off" htmlFor={`pc-${p?.id ?? 'new'}`}><Input id={`pc-${p?.id ?? 'new'}`} name="percent" inputMode="decimal" defaultValue={p?.percentBasisPoints ? p.percentBasisPoints / 100 : ''} /><FieldError name="percent" /></Field>
        <Field label="€ off" htmlFor={`am-${p?.id ?? 'new'}`}><Input id={`am-${p?.id ?? 'new'}`} name="amount" inputMode="decimal" defaultValue={centsToInputValue(p?.amountCents)} /><FieldError name="amount" /></Field>
        <Field label="Buy X" htmlFor={`bx-${p?.id ?? 'new'}`}><Input id={`bx-${p?.id ?? 'new'}`} name="buyQuantity" type="number" min={1} defaultValue={p?.buyQuantity ?? ''} /><FieldError name="buyQuantity" /></Field>
        <Field label="Get Y free" htmlFor={`gy-${p?.id ?? 'new'}`}><Input id={`gy-${p?.id ?? 'new'}`} name="getQuantity" type="number" min={1} defaultValue={p?.getQuantity ?? ''} /></Field>
        <Field label="Combo €" htmlFor={`cp-${p?.id ?? 'new'}`}><Input id={`cp-${p?.id ?? 'new'}`} name="comboPrice" inputMode="decimal" defaultValue={centsToInputValue(p?.comboPriceCents)} /></Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Dishes (empty = all; combo = the dishes in the combo)" htmlFor={`pr-${p?.id ?? 'new'}`}>
          <Select id={`pr-${p?.id ?? 'new'}`} name="productIds" multiple className="h-28" defaultValue={p?.productIds ?? []}>
            {products.map((x) => <option key={x.id} value={x.id}>{pickName(x.translations, langs)}</option>)}
          </Select>
          <FieldError name="productIds" />
        </Field>
        <Field label="Categories (empty = all)" htmlFor={`ca-${p?.id ?? 'new'}`}>
          <Select id={`ca-${p?.id ?? 'new'}`} name="categoryIds" multiple className="h-28" defaultValue={p?.categoryIds ?? []}>
            {categories.map((x) => <option key={x.id} value={x.id}>{pickName(x.translations, langs)}</option>)}
          </Select>
        </Field>
      </div>
      <div>
        <Label>Channels</Label>
        <div className="flex gap-4">
          {(Object.keys(CH) as (keyof typeof CH)[]).map((c) => <Checkbox key={c} name="channels" value={c} label={CH[c]} defaultChecked={p ? p.channels.includes(c) : true} />)}
        </div>
        <FieldError name="channels" />
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Minimum order €" htmlFor={`mo-${p?.id ?? 'new'}`} optionalLabel="opt."><Input id={`mo-${p?.id ?? 'new'}`} name="minOrder" inputMode="decimal" defaultValue={p?.minOrderCents ? centsToInputValue(p.minOrderCents) : ''} /></Field>
        <Field label="Total uses" htmlFor={`ul-${p?.id ?? 'new'}`} optionalLabel="opt."><Input id={`ul-${p?.id ?? 'new'}`} name="usageLimit" type="number" min={1} defaultValue={p?.usageLimit ?? ''} /></Field>
        <Field label="Starts" htmlFor={`sa-${p?.id ?? 'new'}`} optionalLabel="opt."><Input id={`sa-${p?.id ?? 'new'}`} name="startsAt" type="datetime-local" defaultValue={dt(p?.startsAt ?? null)} /></Field>
        <Field label="Ends" htmlFor={`ea-${p?.id ?? 'new'}`} optionalLabel="opt."><Input id={`ea-${p?.id ?? 'new'}`} name="endsAt" type="datetime-local" defaultValue={dt(p?.endsAt ?? null)} /><FieldError name="endsAt" /></Field>
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
    </>
  );

  const summary = (p: Promo) =>
    p.type === 'PERCENTAGE' ? `${(p.percentBasisPoints ?? 0) / 100} % off` : p.type === 'FIXED_AMOUNT' ? `${formatCents(p.amountCents ?? 0)} off` : p.type === 'BUY_X_GET_Y' ? `Buy ${p.buyQuantity} get ${p.getQuantity} free` : `Combo ${formatCents(p.comboPriceCents ?? 0)}`;

  return (
    <>
      <PageHeader title={m.nav.promotions} description="Discounts are calculated on the server for every order. A euro is never discounted twice and totals never go below zero." />
      <div className="mb-4"><Alert tone="info">Promotions are optional. Guests see the saving in their cart and on their order.</Alert></div>
      <div className="grid gap-6 xl:grid-cols-[1fr_520px]">
        <Card>
          <CardHeader title={`Promotions (${promos.length})`} />
          {promos.length === 0 ? (
            <CardBody className="text-sm text-muted">No promotions yet.</CardBody>
          ) : (
            <ul className="divide-y divide-line">
              {promos.map((p) => (
                <li key={p.id} className="px-5 py-4" data-testid="promotion">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{p.name}</span>
                    <span className="flex flex-wrap gap-1.5">
                      <Badge tone={p.isActive ? 'success' : 'neutral'}>{p.isActive ? 'active' : 'off'}</Badge>
                      <Badge>{summary(p)}</Badge>
                      {p.coupons[0] && <Badge tone="dark">code {p.coupons[0].code}</Badge>}
                      <Badge>{p._count.orderDiscounts} uses{p.usageLimit ? ` / ${p.usageLimit}` : ''}</Badge>
                    </span>
                  </div>
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-muted">Edit</summary>
                    <ActionForm action={savePromotionAction} submitLabel="Save promotion" submitVariant="secondary" className="mt-3">
                      <PromoFields p={p} />
                    </ActionForm>
                  </details>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="New promotion" />
          <CardBody>
            <ActionForm action={savePromotionAction} submitLabel="Create promotion" resetOnSuccess testId="promotion-form">
              <PromoFields />
            </ActionForm>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
