import Link from 'next/link';
import { ActionForm } from '@/components/forms/action-form';
import { SetupStepNav } from '@/components/dashboard/setup-nav';
import { Alert, Badge, ButtonLink, Card, CardBody, CardHeader, Checkbox, Field, Input, PageHeader, Select, Stat, statGrid } from '@/components/ui';
import { db } from '@/server/db';
import { pickName } from '@/server/services/menu';
import { routingReview } from '@/server/services/station-assign';
import { requireTenantPage } from '@/server/tenant';
import { currentLocation } from '@/server/current-location';
import { assignCategoryStationsAction, createStationsAction, routeProductsAction, saveStationAction } from '../tables/actions';

const TYPE_LABEL = { KITCHEN: 'Kitchen', CAFE: 'Café', DESSERTS: 'Desserts', DRINKS: 'Drinks', OTHER: 'Other' } as const;

export default async function StationsPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await requireTenantPage(org, 'stations.manage');
  const location = await currentLocation(ctx);
  if (!location) return <Alert tone="warning">No location.</Alert>;
  const base = `/dashboard/${ctx.org.slug}`;
  const [review, counts, products, o] = await Promise.all([
    routingReview(ctx, location.id),
    db.kitchenStation.findMany({ where: { locationId: location.id, organizationId: ctx.org.id }, orderBy: { sortOrder: 'asc' }, include: { _count: { select: { products: true, categories: true } } } }),
    db.menuProduct.findMany({
      where: { organizationId: ctx.org.id, status: { not: 'ARCHIVED' } },
      include: { translations: true, station: true, category: { include: { defaultStation: true, translations: true } } },
      orderBy: [{ category: { sortOrder: 'asc' } }, { sortOrder: 'asc' }],
    }),
    db.restaurantOrganization.findUniqueOrThrow({ where: { id: ctx.org.id }, select: { sourceLanguage: true, enabledLanguages: true } }),
  ]);
  const langs = [o.sourceLanguage, ...o.enabledLanguages];
  const activeStations = review.stations.filter((s) => s.isActive);
  const suggestable = review.categories.filter((c) => c.suggestedStationId && c.suggestedStationId !== c.currentStationId);

  return (
    <>
      <SetupStepNav orgSlug={ctx.org.slug} orgId={ctx.org.id} stepKey="kitchen" locationId={location.id} />
      <PageHeader
        title="Kitchen stations"
        description="Each dish is prepared at one station. An order with food and tea is split automatically: the kitchen screen shows the food, the café screen shows the tea."
      />

      <div className={statGrid(3, 'mb-6')}>
        <Stat label="Stations" value={activeStations.length} />
        <Stat
          label="Dishes with no station"
          value={<span data-testid="unassigned-count">{review.unassignedProducts}</span>}
          hint={review.unassignedProducts > 0 ? 'They would not appear on any kitchen screen' : 'Every dish reaches a screen'}
        />
        <Stat label="Categories" value={review.categories.length} />
      </div>

      {activeStations.length === 0 ? (
        <Card className="mb-6" data-testid="create-stations">
          <CardHeader title="Which stations do you use?" description="Pick the screens your team actually watches. You can rename them afterwards, and MenuNiva never creates stations on its own." />
          <CardBody>
            <ActionForm action={createStationsAction} submitLabel="Create these stations" submitVariant="dark" successText="Created" testId="create-stations-form">
              <input type="hidden" name="org" value={ctx.org.slug} />
              <input type="hidden" name="locationId" value={location.id} />
              <div className="grid gap-3 sm:grid-cols-2">
                <Checkbox name="types" value="KITCHEN" defaultChecked label="Kitchen" description="Food: starters, mains, grills." />
                <Checkbox name="types" value="CAFE" defaultChecked label="Café" description="Tea, coffee, juices and other drinks." />
                <Checkbox name="types" value="DESSERTS" label="Desserts" description="Only if a separate person plates desserts." />
                <Checkbox name="types" value="DRINKS" label="Bar / drinks" description="Only if drinks are made at a separate bar." />
              </div>
            </ActionForm>
          </CardBody>
        </Card>
      ) : (
        <Card className="mb-6" data-testid="category-routing">
          <CardHeader
            title="Send each category to a station"
            description="Dishes follow their category unless a dish has its own station. Suggestions come from the category name — check them before saving."
            action={suggestable.length > 0 ? <Badge tone="lime">{suggestable.length} suggested</Badge> : <Badge tone="success">Nothing to change</Badge>}
          />
          <CardBody>
            {review.missingTypes.length > 0 && (
              <div className="mb-4">
                <Alert tone="info" title="Some categories want a station you do not have">
                  {review.missingTypes.map((t) => TYPE_LABEL[t]).join(', ')} — add it below if you prepare those items separately, or just send them to an existing station.
                </Alert>
              </div>
            )}
            {review.categories.length === 0 ? (
              <p className="text-sm text-muted">
                No categories yet. <Link href={`${base}/menu`} className="underline">Add your menu</Link> first.
              </p>
            ) : (
              <ActionForm action={assignCategoryStationsAction} submitLabel="Save routing" submitVariant="dark" successText="Routing saved" testId="category-routing-form">
                <input type="hidden" name="org" value={ctx.org.slug} />
                {/* A list rather than a table: on phones each category gets the full width for its station picker. */}
                <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line">
                  <li className="hidden grid-cols-[minmax(0,1fr)_5rem_14rem] gap-3 bg-surface-2/60 px-3 py-2 text-xs font-medium text-muted sm:grid" aria-hidden>
                    <span>Category</span>
                    <span>Dishes</span>
                    <span>Station</span>
                  </li>
                  {review.categories.map((c) => (
                    <li key={c.categoryId} className="grid gap-2 px-3 py-2.5 text-sm sm:grid-cols-[minmax(0,1fr)_5rem_14rem] sm:items-center sm:gap-3" data-testid="routing-row" data-category={c.name}>
                      <span className="min-w-0">
                        <span className="font-medium break-words text-ink">{c.name}</span>
                        {!c.currentStationId && <Badge tone="warning" className="ms-2">No station</Badge>}
                        {c.suggestedStationId && c.suggestedStationId !== c.currentStationId && <span className="block text-xs text-muted">Suggested: {c.suggestedStationName}</span>}
                        <span className="block text-xs text-muted sm:hidden">
                          {c.products} dishes{c.overridden > 0 ? ` · ${c.overridden} set individually` : ''}
                        </span>
                      </span>
                      <span className="hidden text-xs text-muted sm:block">
                        {c.products}
                        {c.overridden > 0 && <span className="block">{c.overridden} set individually</span>}
                      </span>
                      <Select
                        name={`station:${c.categoryId}`}
                        defaultValue={c.suggestedStationId ?? c.currentStationId ?? ''}
                        aria-label={`Station for ${c.name}`}
                        className="w-full"
                        data-testid={`station-select-${c.categoryId}`}
                      >
                        <option value="">— no station —</option>
                        {activeStations.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </Select>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted">Saving applies every row as shown above, including the ones you changed by hand. Dishes with their own station keep it.</p>
              </ActionForm>
            )}
          </CardBody>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Stations" />
          <ul className="divide-y divide-line">
            {counts.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <div>
                  <p className="font-medium">
                    {s.name} {!s.isActive && <Badge tone="danger">inactive</Badge>}
                  </p>
                  <p className="text-xs text-muted">
                    {TYPE_LABEL[s.type]} · {s._count.products} dishes directly · default for {s._count.categories} categories
                  </p>
                </div>
                <ButtonLink href={`${base}/kitchen/${s.id}`} variant="secondary" size="sm">
                  Open display
                </ButtonLink>
              </li>
            ))}
            {counts.length === 0 && <li className="px-5 py-4 text-sm text-muted">No stations yet.</li>}
          </ul>
          <CardBody className="border-t border-line">
            <ActionForm action={saveStationAction} submitLabel="Add station" resetOnSuccess className="grid items-end gap-3 space-y-0 sm:grid-cols-[1fr_160px_auto]" testId="add-station-form">
              <input type="hidden" name="org" value={ctx.org.slug} />
              <input type="hidden" name="locationId" value={location.id} />
              <Field label="Name" htmlFor="sname">
                <Input id="sname" name="name" required placeholder="e.g. Cozinha" />
              </Field>
              <Field label="Type" htmlFor="stype">
                <Select id="stype" name="type" defaultValue="KITCHEN">
                  {Object.entries(TYPE_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </Select>
              </Field>
            </ActionForm>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Single dishes" description="Only needed when one dish goes somewhere other than its category — a dessert in the mains, say." />
          <CardBody>
            {review.unrouted.length > 0 ? (
              <Alert tone="warning" title={`${review.unrouted.length} visible dishes reach no screen`}>
                {review.unrouted
                  .slice(0, 5)
                  .map((u) => u.name)
                  .join(', ')}
                {review.unrouted.length > 5 ? '…' : ''}
              </Alert>
            ) : (
              <Alert tone="success">Every visible dish is routed to a station.</Alert>
            )}
            {products.length > 0 && activeStations.length > 0 && (
              <ActionForm action={routeProductsAction} submitLabel="Assign selected dishes" className="mt-4">
                <input type="hidden" name="org" value={ctx.org.slug} />
                <Field label="Send to station" htmlFor="rstation">
                  <Select id="rstation" name="stationId">
                    {activeStations.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                    <option value="">Use category default</option>
                  </Select>
                </Field>
                <div className="max-h-80 space-y-1 overflow-y-auto rounded-xl border border-line p-2">
                  {products.map((p) => (
                    <label key={p.id} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-surface-2">
                      <span className="flex items-center gap-2">
                        <input type="checkbox" name="productIds" value={p.id} className="h-4 w-4" />
                        {pickName(p.translations, langs)}
                      </span>
                      <span className="text-xs text-muted">{p.station?.name ?? (p.category.defaultStation ? `${p.category.defaultStation.name} (category)` : '—')}</span>
                    </label>
                  ))}
                </div>
              </ActionForm>
            )}
            {products.length === 0 && (
              <p className="mt-3 text-sm text-muted">
                No dishes yet.{' '}
                <Link href={`${base}/menu`} className="underline">
                  Add dishes
                </Link>
              </p>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
