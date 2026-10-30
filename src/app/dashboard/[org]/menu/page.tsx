import Link from 'next/link';
import { ActionForm } from '@/components/forms/action-form';
import { InlineAction } from '@/components/forms/inline-action';
import { Alert, Badge, ButtonLink, Card, EmptyState, Field, Input, PageHeader, Select } from '@/components/ui';
import { LANGUAGE_NATIVE_NAME, LANGUAGE_TAG } from '@/i18n/config';
import { formatCents } from '@/lib/money';
import { getMenuAdmin, pickName } from '@/server/services/menu';
import { unroutedDishes } from '@/server/services/publish';
import { requireTenantPage } from '@/server/tenant';
import { moveCategoryAction, moveProductAction, quickAddCategoryAction, setCategoryStationAction, toggleSoldOutAction, deleteCategoryAction } from './actions';

export default async function MenuPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await requireTenantPage(org, 'menu.view');
  const { categories, stations, org: o } = await getMenuAdmin(ctx);
  const base = `/dashboard/${ctx.org.slug}`;
  const canEdit = ctx.can('menu.edit');
  const langs = [o.sourceLanguage, o.defaultLanguage, ...o.enabledLanguages];
  const tag = LANGUAGE_TAG[o.sourceLanguage];
  const productCount = categories.reduce((n, c) => n + c.products.length, 0);
  // Visible dishes that reach no Kitchen/Café screen (e.g. imported into a category without a station).
  const unrouted = stations.length > 0 ? await unroutedDishes(ctx.org.id) : [];
  const unroutedByCategory = categories.filter((c) => unrouted.some((u) => u.categoryId === c.id));

  return (
    <>
      <PageHeader
        title="Menu"
        description={`Source language: ${LANGUAGE_NATIVE_NAME[o.sourceLanguage]}. Prices are entered by you and stored exactly (no rounding).`}
        actions={
          <>
            <ButtonLink href={`${base}/menu/quick`} variant="secondary">Quick prices & sold out</ButtonLink>
            {canEdit && <ButtonLink href={`${base}/menu/translations`} variant="secondary">Translations</ButtonLink>}
            {canEdit && <ButtonLink href={`${base}/menu/upsell`} variant="secondary">Cart suggestions</ButtonLink>}
            {ctx.can('import.manage') && <ButtonLink href={`${base}/import`} variant="secondary">Import menu</ButtonLink>}
          </>
        }
      />

      {stations.length === 0 && canEdit && (
        <div className="mb-4">
          <Alert tone="warning" title="No kitchen stations yet">
            Create stations (for example Kitchen and Café) so each dish is sent to the right screen. <Link className="underline" href={`${base}/stations`}>Create stations</Link>
          </Alert>
        </div>
      )}

      {unrouted.length > 0 && (
        <div className="mb-4" data-testid="unrouted-warning">
          <Alert tone="warning" title={`${unrouted.length} visible dishes are not sent to any kitchen screen`}>
            <p>{unrouted.slice(0, 8).map((u) => u.name).join(', ')}{unrouted.length > 8 ? '…' : ''}. Orders for them create no Kitchen/Café ticket.</p>
            {canEdit && (
              <ul className="mt-2 space-y-2">
                {unroutedByCategory.map((c) => (
                  <li key={c.id}>
                    <ActionForm action={setCategoryStationAction} submitLabel="Set station" submitVariant="secondary" successText="Saved" className="flex flex-wrap items-center gap-2 space-y-0">
                      <input type="hidden" name="org" value={ctx.org.slug} />
                      <input type="hidden" name="categoryId" value={c.id} />
                      <span className="text-sm font-medium">{pickName(c.translations, langs) ?? 'Untitled category'}</span>
                      <Select name="stationId" defaultValue="" className="h-8 w-44 text-xs" aria-label={`Station for ${pickName(c.translations, langs) ?? 'category'}`} required>
                        <option value="" disabled>Choose a station…</option>
                        {stations.map((st) => <option key={st.id} value={st.id}>{st.name}</option>)}
                      </Select>
                    </ActionForm>
                  </li>
                ))}
              </ul>
            )}
          </Alert>
        </div>
      )}

      {canEdit && (
        <Card className="mb-6 p-4">
          <ActionForm action={quickAddCategoryAction} submitLabel="Add category" resetOnSuccess successText="Category added" className="grid items-end gap-3 space-y-0 sm:grid-cols-[1fr_220px_auto]" testId="add-category-form">
            <input type="hidden" name="org" value={ctx.org.slug} />
            <input type="hidden" name="lang" value={o.sourceLanguage} />
            <Field label={`New category name (${LANGUAGE_NATIVE_NAME[o.sourceLanguage]})`} htmlFor="cat-name">
              <Input id="cat-name" name="name" required maxLength={120} placeholder="e.g. Pratos principais" />
            </Field>
            <Field label="Default station" htmlFor="cat-station">
              <Select id="cat-station" name="defaultStationId" defaultValue="">
                <option value="">— none —</option>
                {stations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </Field>
          </ActionForm>
        </Card>
      )}

      {categories.length === 0 ? (
        <EmptyState
          title="Your menu is empty"
          description="Add your first category above, or import your existing menu from a file. MenuNiva never adds sample dishes to your restaurant."
          action={ctx.can('import.manage') && <ButtonLink href={`${base}/import`}>Import menu</ButtonLink>}
        />
      ) : (
        <div className="space-y-5">
          {categories.map((c, ci) => {
            const name = pickName(c.translations, langs) ?? 'Untitled category';
            return (
              <Card key={c.id} data-testid="menu-category">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
                  <div>
                    <h2 className="font-semibold">{name}</h2>
                    <p className="text-xs text-muted">
                      {c.products.length} dishes · station: {c.defaultStation?.name ?? 'not set'} · {c.translations.length}/{o.enabledLanguages.length} languages
                      {!c.isActive && ' · hidden'}
                    </p>
                  </div>
                  {canEdit && (
                    <div className="flex flex-wrap gap-1.5">
                      <InlineAction action={moveCategoryAction} fields={{ org: ctx.org.slug, id: c.id, dir: 'up' }} label="↑" title="Move up" variant="ghost" />
                      <InlineAction action={moveCategoryAction} fields={{ org: ctx.org.slug, id: c.id, dir: 'down' }} label="↓" title="Move down" variant="ghost" />
                      <ButtonLink href={`${base}/menu/categories/${c.id}`} variant="secondary" size="sm">Edit</ButtonLink>
                      {c.products.length === 0 && <InlineAction action={deleteCategoryAction} fields={{ org: ctx.org.slug, id: c.id }} label="Delete" confirm="Delete this empty category?" />}
                      <ButtonLink href={`${base}/menu/products/new?category=${c.id}`} size="sm" data-testid={`add-dish-${ci}`}>+ Add dish</ButtonLink>
                    </div>
                  )}
                </div>
                {c.products.length === 0 ? (
                  <p className="px-5 py-4 text-sm text-muted">No dishes in this category yet.</p>
                ) : (
                  <ul className="divide-y divide-line">
                    {c.products.map((p) => {
                      const price = (ch: string) => p.prices.find((x) => x.channel === ch)?.amountCents;
                      const dineIn = price('DINE_IN');
                      return (
                        <li key={p.id} className="flex flex-wrap items-center gap-3 px-5 py-3" data-testid="menu-product">
                          {p.images[0] ? (
                            <img src={p.images[0].url} alt="" className="h-12 w-12 rounded-xl object-cover" />
                          ) : (
                            <div className="h-12 w-12 rounded-xl bg-surface-2" aria-hidden />
                          )}
                          <div className="min-w-0 flex-1">
                            <Link href={`${base}/menu/products/${p.id}`} className="font-medium hover:underline">
                              {pickName(p.translations, langs)}
                            </Link>
                            <div className="mt-0.5 flex flex-wrap gap-1.5">
                              {p.status === 'DRAFT' && <Badge tone="warning">Draft — not visible</Badge>}
                              {p.status === 'ACTIVE' && <Badge tone="success">Visible</Badge>}
                              {p.soldOut && <Badge tone="danger">Sold out</Badge>}
                              {p.isFeatured && <Badge tone="lime">Featured</Badge>}
                              {p.isPopular && <Badge>Popular</Badge>}
                              {!p.station && !c.defaultStation && <Badge tone="warning">No station</Badge>}
                              {p._count.allergens > 0 && <Badge tone="info">Allergens</Badge>}
                              {p.translations.length < o.enabledLanguages.length && <Badge>{o.enabledLanguages.length - p.translations.length} translations required</Badge>}
                            </div>
                          </div>
                          <div className="text-end text-sm tabular-nums">
                            <p className="font-semibold">{dineIn !== undefined ? formatCents(dineIn, tag) : <span className="text-danger">No dine-in price</span>}</p>
                            <p className="text-xs text-muted">
                              Takeaway {price('TAKEAWAY') !== undefined ? formatCents(price('TAKEAWAY')!, tag) : '—'} · Delivery {price('DELIVERY') !== undefined ? formatCents(price('DELIVERY')!, tag) : '—'}
                            </p>
                          </div>
                          <div className="flex gap-1.5">
                            {ctx.can('menu.availability') && (
                              <InlineAction
                                action={toggleSoldOutAction}
                                fields={{ org: ctx.org.slug, productId: p.id, soldOut: String(!p.soldOut) }}
                                label={p.soldOut ? 'Mark available' : 'Sold out'}
                                variant={p.soldOut ? 'primary' : 'secondary'}
                                testId="toggle-sold-out"
                              />
                            )}
                            {canEdit && (
                              <>
                                <InlineAction action={moveProductAction} fields={{ org: ctx.org.slug, productId: p.id, dir: 'up' }} label="↑" variant="ghost" title="Move up" />
                                <InlineAction action={moveProductAction} fields={{ org: ctx.org.slug, productId: p.id, dir: 'down' }} label="↓" variant="ghost" title="Move down" />
                              </>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Card>
            );
          })}
          <p className="text-xs text-muted">{productCount} dishes in total. Archived dishes are hidden from this list.</p>
        </div>
      )}
    </>
  );
}
