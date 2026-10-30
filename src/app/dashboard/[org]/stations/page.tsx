import Link from 'next/link';
import { ActionForm } from '@/components/forms/action-form';
import { Alert, Badge, ButtonLink, Card, CardBody, CardHeader, Field, Input, PageHeader, Select } from '@/components/ui';
import { db } from '@/server/db';
import { pickName } from '@/server/services/menu';
import { requireTenantPage } from '@/server/tenant';
import { currentLocation } from '@/server/current-location';
import { routeProductsAction, saveStationAction } from '../tables/actions';

const TYPE_LABEL = { KITCHEN: 'Kitchen', CAFE: 'Café', DESSERTS: 'Desserts', DRINKS: 'Drinks', OTHER: 'Other' } as const;

export default async function StationsPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await requireTenantPage(org, 'stations.manage');
  const location = await currentLocation(ctx);
  if (!location) return <Alert tone="warning">No location.</Alert>;
  const base = `/dashboard/${ctx.org.slug}`;
  const [stations, products, o] = await Promise.all([
    db.kitchenStation.findMany({ where: { locationId: location.id, organizationId: ctx.org.id }, orderBy: { sortOrder: 'asc' }, include: { _count: { select: { products: true, categories: true } } } }),
    db.menuProduct.findMany({
      where: { organizationId: ctx.org.id, status: { not: 'ARCHIVED' } },
      include: { translations: true, station: true, category: { include: { defaultStation: true, translations: true } } },
      orderBy: [{ category: { sortOrder: 'asc' } }, { sortOrder: 'asc' }],
    }),
    db.restaurantOrganization.findUniqueOrThrow({ where: { id: ctx.org.id }, select: { sourceLanguage: true, enabledLanguages: true } }),
  ]);
  const langs = [o.sourceLanguage, ...o.enabledLanguages];
  const unrouted = products.filter((p) => !p.station && !p.category.defaultStation);
  return (
    <>
      <PageHeader title="Kitchen stations" description="Each dish is routed to one station. An order with food and tea is split: the kitchen sees the food, the café sees the tea." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Stations" />
          <ul className="divide-y divide-line">
            {stations.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <div>
                  <p className="font-medium">{s.name} {!s.isActive && <Badge tone="danger">inactive</Badge>}</p>
                  <p className="text-xs text-muted">{TYPE_LABEL[s.type]} · {s._count.products} dishes · default for {s._count.categories} categories</p>
                </div>
                <ButtonLink href={`${base}/kitchen/${s.id}`} variant="secondary" size="sm">Open display</ButtonLink>
              </li>
            ))}
            {stations.length === 0 && <li className="px-5 py-4 text-sm text-muted">No stations yet.</li>}
          </ul>
          <CardBody className="border-t border-line">
            <ActionForm action={saveStationAction} submitLabel="Add station" resetOnSuccess className="grid items-end gap-3 space-y-0 sm:grid-cols-[1fr_160px_auto]" testId="add-station-form">
              <input type="hidden" name="org" value={ctx.org.slug} />
              <input type="hidden" name="locationId" value={location.id} />
              <Field label="Name" htmlFor="sname"><Input id="sname" name="name" required placeholder="e.g. Cozinha" /></Field>
              <Field label="Type" htmlFor="stype">
                <Select id="stype" name="type" defaultValue="KITCHEN">
                  {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </Select>
              </Field>
            </ActionForm>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Routing" description="Set a default station per category in Menu → Edit category, or assign dishes here." />
          <CardBody>
            {unrouted.length > 0 ? (
              <Alert tone="warning" title={`${unrouted.length} dishes have no station`}>They would not appear on any kitchen display. Assign them below.</Alert>
            ) : (
              <Alert tone="success">Every dish is routed to a station.</Alert>
            )}
            {products.length > 0 && stations.length > 0 && (
              <ActionForm action={routeProductsAction} submitLabel="Assign selected dishes" className="mt-4">
                <input type="hidden" name="org" value={ctx.org.slug} />
                <Field label="Send to station" htmlFor="rstation">
                  <Select id="rstation" name="stationId">
                    {stations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    <option value="">Use category default</option>
                  </Select>
                </Field>
                <div className="max-h-80 space-y-1 overflow-y-auto rounded-xl border border-line p-2">
                  {products.map((p) => (
                    <label key={p.id} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-surface-2">
                      <span className="flex items-center gap-2">
                        <input type="checkbox" name="productIds" value={p.id} />
                        {pickName(p.translations, langs)}
                      </span>
                      <span className="text-xs text-muted">{p.station?.name ?? (p.category.defaultStation ? `${p.category.defaultStation.name} (category)` : '—')}</span>
                    </label>
                  ))}
                </div>
              </ActionForm>
            )}
            {products.length === 0 && <p className="mt-3 text-sm text-muted">No dishes yet. <Link href={`${base}/menu`} className="underline">Add dishes</Link></p>}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
