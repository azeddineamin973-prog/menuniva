import { notFound } from 'next/navigation';
import { env } from '@/server/env';
import { ActionForm } from '@/components/forms/action-form';
import { InlineAction } from '@/components/forms/inline-action';
import { Badge, Card, CardBody, CardHeader, Checkbox, Field, Input, PageHeader } from '@/components/ui';
import type { LanguageCode } from '@/generated/prisma/enums';
import { getMessages } from '@/i18n';
import { LANGUAGE_TAG } from '@/i18n/config';
import { centsToInputValue, formatCents } from '@/lib/money';
import { getMenuAdmin, getProductAdmin, pickName } from '@/server/services/menu';
import { db } from '@/server/db';
import { accessibleLocations, requireTenantPage } from '@/server/tenant';
import { removeProductImageAction, saveLocationOverrideAction, setProductStatusAction, uploadProductImageAction } from '../../actions';
import { ScheduleEditor } from '../../schedule-editor';
import { groupSchedules } from '@/lib/schedules';
import { AllergenEditor } from '../allergen-editor';
import { OptionsEditor } from '../options-editor';
import { ProductEditor } from '../product-editor';

type Names = Partial<Record<LanguageCode, string>>;

export default async function ProductPage({ params }: { params: Promise<{ org: string; id: string }> }) {
  const { org, id } = await params;
  const ctx = await requireTenantPage(org, 'menu.edit');
  const [product, menu, locations, taxClasses] = await Promise.all([
    getProductAdmin(ctx, id),
    getMenuAdmin(ctx),
    accessibleLocations(ctx),
    db.taxClass.findMany({ where: { organizationId: ctx.org.id, approvedAt: { not: null } }, orderBy: { rateBasisPoints: 'desc' } }),
  ]);
  if (!product) notFound();
  const { categories, stations, org: o } = menu;
  const base = `/dashboard/${ctx.org.slug}`;
  const langs = [o.sourceLanguage, ...o.enabledLanguages];
  const m = getMessages(ctx.user.preferredLanguage);
  const price = (ch: string) => centsToInputValue(product.prices.find((p) => p.channel === ch)?.amountCents);

  return (
    <>
      <PageHeader
        title={pickName(product.translations, langs) ?? 'Dish'}
        description={product.status === 'ACTIVE' ? 'Visible to guests (when your location is published).' : product.status === 'DRAFT' ? 'Draft — not visible to guests.' : 'Archived.'}
        actions={
          <>
            {product.status !== 'ARCHIVED' ? (
              <InlineAction action={setProductStatusAction} fields={{ org: ctx.org.slug, productId: product.id, status: 'ARCHIVED' }} label="Archive" confirm="Archive this dish? It will be hidden everywhere. Past orders keep their details." />
            ) : (
              <InlineAction action={setProductStatusAction} fields={{ org: ctx.org.slug, productId: product.id, status: 'DRAFT' }} label="Restore as draft" />
            )}
          </>
        }
      />
      <div className="space-y-6">
        <ProductEditor
          org={ctx.org.slug}
          base={base}
          sourceLanguage={o.sourceLanguage}
          languages={o.enabledLanguages}
          categories={categories.map((c) => ({ id: c.id, name: pickName(c.translations, langs) ?? 'Untitled', defaultStation: c.defaultStation?.name ?? null }))}
          stations={stations.map((s) => ({ id: s.id, name: s.name }))}
          taxClasses={taxClasses.map((t) => ({ id: t.id, name: `${t.name} (${(t.rateBasisPoints / 100).toLocaleString('pt-PT')} %)` }))}
          initial={{
            id: product.id,
            taxClassId: product.taxClassId,
            categoryId: product.categoryId,
            stationId: product.stationId,
            status: product.status === 'ACTIVE' ? 'ACTIVE' : 'DRAFT',
            isFeatured: product.isFeatured,
            isPopular: product.isPopular,
            tags: product.tags,
            translations: Object.fromEntries(product.translations.map((t) => [t.language, { name: t.name, description: t.description ?? '', ingredients: t.ingredients ?? '' }])),
            prices: { DINE_IN: price('DINE_IN'), TAKEAWAY: price('TAKEAWAY'), DELIVERY: price('DELIVERY') },
          }}
        />

        <OptionsEditor
          org={ctx.org.slug}
          productId={product.id}
          languages={o.enabledLanguages}
          source={o.sourceLanguage}
          initial={{
            variants: product.variants.map((v) => ({ names: v.names as Names, priceDelta: centsToInputValue(v.priceDeltaCents), isDefault: v.isDefault, isAvailable: v.isAvailable })),
            groups: product.modifierGroups.map((g) => ({
              names: g.names as Names,
              minSelect: g.minSelect,
              maxSelect: g.maxSelect,
              options: g.options.map((x) => ({ names: x.names as Names, priceDelta: centsToInputValue(x.priceDeltaCents), maxQuantity: x.maxQuantity, isAvailable: x.isAvailable })),
            })),
          }}
        />

        <div className="grid gap-6 xl:grid-cols-2">
          <AllergenEditor
            org={ctx.org.slug}
            productId={product.id}
            labels={m.allergens}
            initial={Object.fromEntries(product.allergens.map((a) => [a.allergen, a.presence]))}
            verifiedAt={product.allergensVerifiedAt?.toISOString() ?? null}
            hasUnverifiedSuggestions={product.allergens.some((a) => a.origin !== 'MANUAL' && !a.verifiedAt)}
          />
          <Card>
            <CardHeader title="Photos" description="Only publish photos you own or have permission to use." />
            <CardBody className="space-y-4">
              {product.images.length > 0 && (
                <div className="flex flex-wrap gap-3">
                  {product.images.map((img) => (
                    <div key={img.id} className="relative">
                      <img src={img.url} alt="" className="h-24 w-24 rounded-xl object-cover" />
                      <div className="mt-1">
                        <InlineAction action={removeProductImageAction} fields={{ org: ctx.org.slug, imageId: img.id }} label="Remove" variant="ghost" />
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <ActionForm action={uploadProductImageAction} submitLabel="Upload photo" resetOnSuccess>
                <input type="hidden" name="org" value={ctx.org.slug} />
                <input type="hidden" name="productId" value={product.id} />
                <Field label="Photo" htmlFor="image" hint="PNG, JPEG or WebP, max 5 MB.">
                  <Input id="image" name="image" type="file" accept="image/png,image/jpeg,image/webp" data-max-bytes={env.UPLOAD_MAX_BYTES} required className="pt-2" />
                </Field>
                <Checkbox name="rightsConfirmed" label="I have the right to publish this photo." />
              </ActionForm>
            </CardBody>
          </Card>
        </div>

        <div className="grid gap-6 xl:grid-cols-2">
          <ScheduleEditor org={ctx.org.slug} target="product" id={product.id} initial={groupSchedules(product.schedules)} />
          <Card>
            <CardHeader title="Per-location availability & prices" description="Leave a price empty to use the base price above." />
            <CardBody className="space-y-4">
              {locations.map((l) => {
                const o = product.locationOverrides.find((x) => x.locationId === l.id);
                return (
                  <ActionForm key={l.id} action={saveLocationOverrideAction} submitLabel={`Save for ${l.name}`} submitVariant="secondary" testId={`override-${l.slug}`}>
                    <input type="hidden" name="org" value={ctx.org.slug} />
                    <input type="hidden" name="productId" value={product.id} />
                    <input type="hidden" name="locationId" value={l.id} />
                    <p className="text-sm font-medium">{l.name}</p>
                    <div className="flex flex-wrap gap-4">
                      <Checkbox name="isAvailable" label="Offered here" defaultChecked={o?.isAvailable ?? true} />
                      <Checkbox name="soldOut" label="Sold out here" defaultChecked={o?.soldOut ?? false} />
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <Field label="Dine-in" htmlFor={`di-${l.id}`}><Input id={`di-${l.id}`} name="dineIn" inputMode="decimal" placeholder="base" defaultValue={centsToInputValue(o?.dineInPriceCents)} /></Field>
                      <Field label="Takeaway" htmlFor={`ta-${l.id}`}><Input id={`ta-${l.id}`} name="takeaway" inputMode="decimal" placeholder="base" defaultValue={centsToInputValue(o?.takeawayPriceCents)} /></Field>
                      <Field label="Delivery" htmlFor={`de-${l.id}`}><Input id={`de-${l.id}`} name="delivery" inputMode="decimal" placeholder="base" defaultValue={centsToInputValue(o?.deliveryPriceCents)} /></Field>
                    </div>
                  </ActionForm>
                );
              })}
            </CardBody>
          </Card>
        </div>

        {product.externalPrices.length > 0 && (
          <Card>
            <CardHeader title="Imported platform prices (reference only)" description="Captured during import. They are not used for MenuNiva orders and are not kept in sync." />
            <ul className="divide-y divide-line text-sm">
              {product.externalPrices.map((e) => (
                <li key={e.id} className="flex justify-between px-5 py-2.5">
                  <span>{e.provider === 'GLOVO' ? 'Glovo' : e.provider === 'UBER_EATS' ? 'Uber Eats' : e.provider}</span>
                  <span className="tabular-nums">{formatCents(e.amountCents, LANGUAGE_TAG[o.sourceLanguage])} <Badge>captured {e.capturedAt.toISOString().slice(0, 10)}</Badge></span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </>
  );
}
