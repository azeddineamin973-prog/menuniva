import { ActionForm } from '@/components/forms/action-form';
import { InlineAction } from '@/components/forms/inline-action';
import { Alert, Badge, ButtonLink, Card, CardBody, CardHeader, EmptyState, Field, Input, PageHeader, Select } from '@/components/ui';
import { db } from '@/server/db';
import { listTablesForLocation } from '@/server/services/tables';
import { accessibleLocations, requireTenantPage } from '@/server/tenant';
import { createTablesAction, rotateQrAction, saveAreaAction } from './actions';

export default async function TablesPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await requireTenantPage(org, 'tables.view');
  const [location] = await accessibleLocations(ctx);
  if (!location) return <Alert tone="warning">No location.</Alert>;
  const [areas, tables] = await Promise.all([
    db.diningArea.findMany({ where: { locationId: location.id, organizationId: ctx.org.id }, orderBy: { sortOrder: 'asc' } }),
    listTablesForLocation(ctx, location.id),
  ]);
  const base = `/dashboard/${ctx.org.slug}`;
  const canManage = ctx.can('tables.manage');
  return (
    <>
      <PageHeader
        title="Tables & QR codes"
        description="Each table has its own QR code. Guests scan it to order — no app, no login. Orders still need staff acceptance."
        actions={
          tables.length > 0 && (
            <>
              <ButtonLink href={`${base}/tables/print`} variant="secondary">Printable QR sheet</ButtonLink>
              <ButtonLink href={`/api/dashboard/${ctx.org.slug}/qr/sheet.pdf?location=${location.id}`} variant="secondary" prefetch={false}>Download PDF</ButtonLink>
            </>
          )
        }
      />
      {!location.tableOrderingEnabled && (
        <div className="mb-4">
          <Alert tone="warning" title="Table ordering is switched off">
            Guests can scan and view the menu but cannot order. Turn it on in Settings → Ordering channels.
          </Alert>
        </div>
      )}
      {canManage && (
        <div className="mb-6 grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader title="Add tables" description="Type labels separated by commas, or a range like 1-12. You decide how many tables you have." />
            <CardBody>
              <ActionForm action={createTablesAction} submitLabel="Create tables" resetOnSuccess successText="Tables created" testId="create-tables-form">
                <input type="hidden" name="org" value={ctx.org.slug} />
                <input type="hidden" name="locationId" value={location.id} />
                <Field label="Table labels" htmlFor="labels" hint="Examples: 1-10 · T1-T8 · Tenda 1, Tenda 2">
                  <Input id="labels" name="labels" required placeholder="1-10" />
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Dining area" htmlFor="areaId">
                    <Select id="areaId" name="areaId" defaultValue="">
                      <option value="">— none —</option>
                      {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </Select>
                  </Field>
                  <Field label="Seats per table" htmlFor="seats" optionalLabel="optional">
                    <Input id="seats" name="seats" type="number" min={1} max={50} />
                  </Field>
                </div>
              </ActionForm>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Dining areas" description="Rooms, floors or zones (e.g. terrace, tent)." />
            <CardBody className="space-y-3">
              <ul className="flex flex-wrap gap-2">
                {areas.map((a) => <li key={a.id}><Badge>{a.name}</Badge></li>)}
                {areas.length === 0 && <li className="text-sm text-muted">No areas yet.</li>}
              </ul>
              <ActionForm action={saveAreaAction} submitLabel="Add area" resetOnSuccess className="flex items-end gap-2 space-y-0">
                <input type="hidden" name="org" value={ctx.org.slug} />
                <input type="hidden" name="locationId" value={location.id} />
                <Input name="name" required placeholder="New area name" aria-label="New area name" />
              </ActionForm>
            </CardBody>
          </Card>
        </div>
      )}
      {tables.length === 0 ? (
        <EmptyState title="No tables yet" description="Create tables above to generate their QR codes." />
      ) : (
        <Card>
          <CardHeader title={`${tables.length} tables`} />
          <ul className="grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-3">
            {tables.map((t) => {
              const token = t.qrTokens[0]?.token;
              return (
                <li key={t.id} className="flex items-center gap-3 bg-surface p-4" data-testid="table-card">
                  {token && <img src={`/api/dashboard/${ctx.org.slug}/qr/${t.id}?format=svg`} alt={`QR code for table ${t.label}`} className="h-20 w-20 rounded-lg border border-line" />}
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">Table {t.label} {!t.isActive && <Badge tone="danger">inactive</Badge>}</p>
                    <p className="text-xs text-muted">{t.area?.name ?? 'No area'}{t.seats ? ` · ${t.seats} seats` : ''}</p>
                    {t.sessions[0] && <Badge tone="lime">Occupied (open session)</Badge>}
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {token && (
                        <>
                          <ButtonLink href={`/api/dashboard/${ctx.org.slug}/qr/${t.id}?format=png`} variant="secondary" size="sm" prefetch={false}>PNG</ButtonLink>
                          <ButtonLink href={`/api/dashboard/${ctx.org.slug}/qr/${t.id}?format=svg&download=1`} variant="secondary" size="sm" prefetch={false}>SVG</ButtonLink>
                          <a href={`/t/${token}`} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center px-2 text-sm underline-offset-2 hover:underline" data-testid="open-table-link">Open</a>
                        </>
                      )}
                      {canManage && <InlineAction action={rotateQrAction} fields={{ org: ctx.org.slug, tableId: t.id }} label="New QR" variant="ghost" confirm="Create a new QR code? The old printed code will stop working." />}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
      <p className="mt-4 text-xs text-muted">
        A QR code can be photographed and shared, so it does not prove a guest is at the table. Every table order must be accepted by staff, and orders are rate-limited.
      </p>
    </>
  );
}
