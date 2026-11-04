import Link from 'next/link';
import { ActionForm } from '@/components/forms/action-form';
import { Alert, ButtonLink, Card, CardHeader, Field, Input, PageHeader, Select } from '@/components/ui';
import { LANGUAGE_NATIVE_NAME, LANGUAGE_TAG } from '@/i18n/config';
import { getMenuAdmin, pickName } from '@/server/services/menu';
import { unroutedDishes } from '@/server/services/publish';
import { NO_PREPARATION, prepRoute } from '@/server/services/routing';
import { currentLocation } from '@/server/current-location';
import { requireTenantPage } from '@/server/tenant';
import { SetupStepNav } from '@/components/dashboard/setup-nav';
import { quickAddCategoryAction, setCategoryStationAction } from './actions';
import { MenuManager, type MenuCategoryView } from './menu-manager';
import { MenuTabs } from './menu-tabs';

export default async function MenuPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await requireTenantPage(org, 'menu.view');
  const [{ categories, stations: allStations, org: o }, location] = await Promise.all([getMenuAdmin(ctx), currentLocation(ctx)]);
  const base = `/dashboard/${ctx.org.slug}`;
  const canEdit = ctx.can('menu.edit');
  const canImport = ctx.can('import.manage');
  const langs = [o.sourceLanguage, o.defaultLanguage, ...o.enabledLanguages];
  const enabled = o.enabledLanguages.length;
  // Stations are per location; the menu is shared. Routing is shown for the location being worked in.
  const stations = allStations.filter((s) => s.locationId === location?.id);
  // Visible dishes guests cannot order here: no switched-on station of this location prepares them.
  const unrouted = location && stations.length > 0 ? await unroutedDishes(ctx.org.id, location.id) : [];
  const unroutedIds = new Set(unrouted.map((u) => u.id));
  // A category another location's station prepares is fixed from that location: changing it here would change it there too.
  const unroutedByCategory = categories.filter((c) => unrouted.some((u) => u.categoryId === c.id) && (!c.defaultStation || c.defaultStation.locationId === location?.id));

  const view: MenuCategoryView[] = categories.map((c) => ({
    id: c.id,
    name: pickName(c.translations, langs) ?? 'Untitled category',
    isActive: c.isActive,
    stationName: c.defaultStation?.name ?? null,
    languages: `${c.translations.length}/${enabled} languages`,
    products: c.products.map((p) => {
      const price = (ch: string) => p.prices.find((x) => x.channel === ch)?.amountCents ?? null;
      return {
        id: p.id,
        name: pickName(p.translations, langs) ?? 'Untitled dish',
        status: p.status,
        soldOut: p.soldOut,
        featured: p.isFeatured,
        popular: p.isPopular,
        image: p.images[0]?.url ?? null,
        dineIn: price('DINE_IN'),
        takeaway: price('TAKEAWAY'),
        delivery: price('DELIVERY'),
        noStation: unroutedIds.has(p.id),
        noPreparation: !!location && prepRoute({ ...p, category: c }, location.id).kind === 'none',
        allergens: p._count.allergens > 0,
        missingTranslations: Math.max(0, enabled - p.translations.length),
      };
    }),
  }));
  const firstCategory = categories[0]?.id;

  const addCategory = canEdit ? (
    <Card id="new-category" className="scroll-mt-20">
      <CardHeader title="New category" icon="plus" />
      <div className="px-4 pb-4">
        <ActionForm action={quickAddCategoryAction} submitLabel="Add category" submitVariant="secondary" resetOnSuccess successText="Category added" className="grid items-end gap-3 space-y-0" testId="add-category-form">
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
      </div>
    </Card>
  ) : null;

  return (
    <>
      <SetupStepNav orgSlug={ctx.org.slug} orgId={ctx.org.id} stepKey="import" />
      <PageHeader
        title="Menu"
        description={`Dishes, prices and availability. Source language: ${LANGUAGE_NATIVE_NAME[o.sourceLanguage]}. Prices are stored exactly as you enter them.`}
        actions={
          <>
            {canImport && <ButtonLink href={`${base}/import`} variant="secondary" icon="import">Import menu</ButtonLink>}
            {canEdit && firstCategory && <ButtonLink href={`${base}/menu/products/new?category=${firstCategory}`} icon="plus">Add dish</ButtonLink>}
          </>
        }
      />
      <MenuTabs base={base} active="dishes" ctx={ctx} />

      {stations.length === 0 && canEdit && (
        <div className="mb-4">
          <Alert tone="warning" title="No kitchen stations yet" action={<ButtonLink href={`${base}/stations`} variant="secondary" size="sm">Create stations</ButtonLink>}>
            Create stations (for example Kitchen and Café) so each dish is sent to the right screen.
          </Alert>
        </div>
      )}

      {unrouted.length > 0 && (
        <div className="mb-4" data-testid="unrouted-warning">
          <Alert tone="warning" title={`${unrouted.length} visible dishes are not sent to any kitchen screen here`}>
            <p>{unrouted.slice(0, 8).map((u) => u.name).join(', ')}{unrouted.length > 8 ? '…' : ''}. Guests cannot order them at {location?.name} until a station prepares them, or until you mark them as needing no preparation.</p>
            {canEdit && (
              <ul className="mt-2 space-y-2">
                {unroutedByCategory.map((c) => (
                  <li key={c.id}>
                    <ActionForm action={setCategoryStationAction} submitLabel="Set station" submitVariant="secondary" successText="Saved" className="flex flex-wrap items-center gap-2 space-y-0">
                      <input type="hidden" name="org" value={ctx.org.slug} />
                      <input type="hidden" name="categoryId" value={c.id} />
                      <span className="text-sm font-medium">{pickName(c.translations, langs) ?? 'Untitled category'}</span>
                      <Select name="stationId" defaultValue="" className="h-8 w-56 text-xs" aria-label={`Station for ${pickName(c.translations, langs) ?? 'category'}`} required>
                        <option value="" disabled>Choose a station…</option>
                        {stations.filter((st) => st.isActive).map((st) => <option key={st.id} value={st.id}>{st.name}</option>)}
                        <option value={NO_PREPARATION}>No preparation (handed over at the counter)</option>
                      </Select>
                    </ActionForm>
                  </li>
                ))}
              </ul>
            )}
          </Alert>
        </div>
      )}

      <MenuManager
        org={ctx.org.slug}
        base={base}
        tag={LANGUAGE_TAG[o.sourceLanguage]}
        categories={view}
        canEdit={canEdit}
        canAvailability={ctx.can('menu.availability')}
        emptyAction={canImport ? <ButtonLink href={`${base}/import`} icon="import">Import menu</ButtonLink> : null}
        addCategory={addCategory}
      />
      <p className="mt-4 text-xs text-muted">
        Archived dishes are hidden from this list. {canEdit && <Link className="underline underline-offset-2 hover:text-ink" href={`${base}/stations`}>Manage stations</Link>}
      </p>
    </>
  );
}
