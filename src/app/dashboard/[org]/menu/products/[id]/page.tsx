import { notFound } from 'next/navigation';
import { env } from '@/server/env';
import { ActionForm } from '@/components/forms/action-form';
import { InlineAction } from '@/components/forms/inline-action';
import { Badge, Card, CardBody, CardHeader, Checkbox, Field, Input, PageHeader } from '@/components/ui';
import type { LanguageCode } from '@/generated/prisma/enums';
import { getMessages } from '@/i18n';
import { LANGUAGE_TAG } from '@/i18n/config';
import { centsToInputValue, formatCents } from '@/lib/money';
import { getMenuAdmin, getProductAdmin, MAX_PRODUCT_IMAGES, pickName } from '@/server/services/menu';
import { db } from '@/server/db';
import { accessibleLocations, requireTenantPage } from '@/server/tenant';
import { saveLocationOverrideAction, setProductStatusAction } from '../../actions';
import { PhotoManager } from '../photo-manager';
import { ScheduleEditor } from '../../schedule-editor';
import { groupSchedules } from '@/lib/schedules';
import { AllergenEditor } from '../allergen-editor';
import { OptionsEditor } from '../options-editor';
import { ProductEditor } from '../product-editor';
import { NO_PREPARATION } from '@/server/services/routing';

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
        back={{ href: `${base}/menu`, label: 'Menu' }}
        title={pickName(product.translations, langs) ?? 'Dish'}
        meta={
          product.status === 'ACTIVE' ? (
            <Badge tone="success" dot>Visible</Badge>
          ) : product.status === 'DRAFT' ? (
            <Badge tone="warning" dot>Draft</Badge>
          ) : (
            <Badge>Archived</Badge>
          )
        }
        description={product.status === 'ACTIVE' ? 'Visible to guests (when your location is published).' : product.status === 'DRAFT' ? 'Draft — not visible to guests.' : 'Archived.'}
        actions={
          <>
            {product.status !== 'ARCHIVED' ? (
              <InlineAction action={setProductStatusAction} fields={{ org: ctx.org.slug, productId: product.id, status: 'ARCHIVED' }} label="Archive" variant="ghost" confirm="Archive this dish? It will be hidden everywhere. Past orders keep their details." />
            ) : (
              <InlineAction action={setProductStatusAction} fields={{ org: ctx.org.slug, productId: product.id, status: 'DRAFT' }} label="Restore as draft" />
            )}
          </>
        }
      />
      {/* Jump links: the dish page is long, and each part saves on its own. */}
      <nav aria-label="Dish sections" className="mn-scroll -mx-4 mb-5 flex gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        {(
          [
            ['details', 'Details & prices'],
            ['options', 'Sizes & extras'],
            ['allergens', 'Allergens'],
            ['photos', 'Photos'],
            ['availability', 'Availability'],
          ] as const
        ).map(([id, label]) => (
          <a key={id} href={`#${id}`} className="inline-flex min-h-8 shrink-0 items-center rounded-lg border border-line bg-surface px-2.5 text-[13px] font-medium text-ink-2 shadow-xs hover:border-line-strong hover:text-ink pointer-coarse:min-h-10">
            {label}
          </a>
        ))}
      </nav>
      <div className="space-y-6">
        <div id="details" className="scroll-mt-20">
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
            stationId: product.stationId ?? (product.noPreparation ? NO_PREPARATION : null),
            status: product.status === 'ACTIVE' ? 'ACTIVE' : 'DRAFT',
            isFeatured: product.isFeatured,
            isPopular: product.isPopular,
            tags: product.tags,
            translations: Object.fromEntries(product.translations.map((t) => [t.language, { name: t.name, description: t.description ?? '', ingredients: t.ingredients ?? '' }])),
            prices: { DINE_IN: price('DINE_IN'), TAKEAWAY: price('TAKEAWAY'), DELIVERY: price('DELIVERY') },
          }}
        />
        </div>

        <div id="options" className="scroll-mt-20">
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
        </div>

        <div className="grid items-start gap-6 xl:grid-cols-2">
          <div id="allergens" className="scroll-mt-20">
          <AllergenEditor
            org={ctx.org.slug}
            productId={product.id}
            labels={m.allergens}
            initial={Object.fromEntries(product.allergens.map((a) => [a.allergen, a.presence]))}
            verifiedAt={product.allergensVerifiedAt?.toISOString() ?? null}
            hasUnverifiedSuggestions={product.allergens.some((a) => a.origin !== 'MANUAL' && !a.verifiedAt)}
          />
          </div>
          <PhotoManager
            org={ctx.org.slug}
            productId={product.id}
            photos={product.images.map((img) => ({ id: img.id, url: img.url, origin: img.origin }))}
            maxPhotos={MAX_PRODUCT_IMAGES}
            maxBytes={env.UPLOAD_MAX_BYTES}
          />
        </div>

        <div id="availability" className="grid scroll-mt-20 items-start gap-6 xl:grid-cols-2">
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
