import { ActionForm } from '@/components/forms/action-form';
import { InlineAction } from '@/components/forms/inline-action';
import { Alert, Badge, ButtonLink, Card, CardBody, CardHeader, EmptyState, Field, Icon, Input, PageHeader, Select, Stat, statGrid } from '@/components/ui';
import { cn } from '@/lib/cn';
import { db } from '@/server/db';
import { listTablesForLocation, qrSvg, tableQrUrl } from '@/server/services/tables';
import { requireTenantPage } from '@/server/tenant';
import { currentLocation } from '@/server/current-location';
import { SetupStepNav } from '@/components/dashboard/setup-nav';
import { createTablesAction, rotateQrAction, saveAreaAction } from './actions';
import { openTableAction } from '../bills/actions';

const smallLink =
  'inline-flex h-8 items-center gap-1 rounded-lg border border-line bg-surface px-2 text-xs font-medium text-ink-2 shadow-xs hover:border-line-strong hover:text-ink pointer-coarse:h-10 pointer-coarse:px-3';

export default async function TablesPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await requireTenantPage(org, 'tables.view');
  const location = await currentLocation(ctx);
  if (!location) return <Alert tone="warning">No location.</Alert>;
  const [areas, tables] = await Promise.all([
    db.diningArea.findMany({ where: { locationId: location.id, organizationId: ctx.org.id }, orderBy: { sortOrder: 'asc' } }),
    listTablesForLocation(ctx, location.id),
  ]);
  const base = `/dashboard/${ctx.org.slug}`;
  const canManage = ctx.can('tables.manage');
  const occupied = tables.filter((t) => t.sessions[0]).length;
  // QR codes are drawn here, inside the page (about 2 KB each), instead of one signed-in image
  // request per table: a page with 30 tables used to make 30 extra requests on every visit.
  const qrImages = new Map(
    await Promise.all(
      tables.filter((t) => t.qrTokens[0]).map(async (t) => [t.id, `data:image/svg+xml;base64,${Buffer.from(await qrSvg(tableQrUrl(t.qrTokens[0].token), 160)).toString('base64')}`] as const),
    ),
  );
  // Tables grouped by dining area (in area order), tables without an area last.
  const groups = [
    ...areas.map((a) => ({ key: a.id, name: a.name, list: tables.filter((t) => t.areaId === a.id) })),
    { key: 'none', name: areas.length ? 'No area' : null, list: tables.filter((t) => !t.areaId) },
  ].filter((g) => g.list.length > 0);

  const manage = canManage && (
    <div className="space-y-4 xl:sticky xl:top-20">
      <Card>
        <CardHeader title="Add tables" icon="plus" description="Labels separated by commas, or a range like 1-12." />
        <CardBody>
          <ActionForm action={createTablesAction} submitLabel="Create tables" resetOnSuccess successText="Tables created" testId="create-tables-form">
            <input type="hidden" name="org" value={ctx.org.slug} />
            <input type="hidden" name="locationId" value={location.id} />
            <Field label="Table labels" htmlFor="labels" hint="Examples: 1-10 · T1-T8 · Tenda 1, Tenda 2">
              <Input id="labels" name="labels" required placeholder="1-10" />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
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
        <CardHeader title="Dining areas" icon="layers" description="Rooms, floors or zones (e.g. terrace, tent)." />
        <CardBody className="space-y-3">
          <ul className="flex flex-wrap gap-1.5">
            {areas.map((a) => <li key={a.id}><Badge>{a.name}</Badge></li>)}
            {areas.length === 0 && <li className="text-sm text-muted">No areas yet.</li>}
          </ul>
          <ActionForm action={saveAreaAction} submitLabel="Add area" submitVariant="secondary" resetOnSuccess className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 space-y-0">
            <input type="hidden" name="org" value={ctx.org.slug} />
            <input type="hidden" name="locationId" value={location.id} />
            <Input name="name" required placeholder="New area name" aria-label="New area name" />
          </ActionForm>
        </CardBody>
      </Card>
    </div>
  );

  const list =
    tables.length === 0 ? (
      <EmptyState icon="qr" title="No tables yet" description={canManage ? 'Add your tables to generate one QR code per table. Guests scan it to order, with no app or login.' : 'A manager needs to add the tables first.'} />
    ) : (
      <div className="space-y-5">
        {groups.map((g) => (
          <section key={g.key} aria-label={g.name ?? 'Tables'}>
            {g.name && (
              <h2 className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-ink-2">
                {g.name}
                <span className="rounded-md bg-surface-2 px-1.5 text-xs font-medium text-muted tabular-nums">{g.list.length}</span>
              </h2>
            )}
            <ul className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
              {g.list.map((t) => {
                const token = t.qrTokens[0]?.token;
                const session = t.sessions[0];
                return (
                  <li key={t.id} className={cn('flex gap-3.5 rounded-[var(--radius-card)] border bg-surface p-3.5 shadow-xs', session ? 'border-accent/30' : 'border-line')} data-testid="table-card">
                    {token ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={qrImages.get(t.id)} alt={`QR code for table ${t.label}`} className="size-20 shrink-0 rounded-lg border border-line bg-white p-1" width={80} height={80} decoding="async" />
                    ) : (
                      <span className="flex size-20 shrink-0 items-center justify-center rounded-lg border border-dashed border-line text-muted" aria-hidden>
                        <Icon name="qr" className="size-6" />
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <p className="font-semibold text-ink">Table {t.label}</p>
                        {!t.isActive && <Badge tone="danger">inactive</Badge>}
                        {session ? (
                          <Badge tone="lime" dot>Occupied</Badge>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs text-muted">
                            <span className="size-1.5 rounded-full bg-line-strong" aria-hidden />
                            Free
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted">{t.area?.name ?? 'No area'}{t.seats ? ` · ${t.seats} seats` : ''}</p>
                      {session?.verificationCode && (
                        <div className="mt-1.5">
                          <Badge tone="dark" data-testid="table-code">Code {session.verificationCode}</Badge>
                        </div>
                      )}
                      {!session && location.tableCodeRequired && ctx.can('tasks.manage') && (
                        <div className="mt-1.5">
                          <InlineAction action={openTableAction} fields={{ org: ctx.org.slug, tableId: t.id }} label="Open table" variant="primary" testId="open-table" />
                        </div>
                      )}
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {session && ctx.can('payments.record') && (
                          <a href={`${base}/bills/${session.id}`} className={cn(smallLink, 'border-accent/30 text-ink')} data-testid="bill-link">
                            <Icon name="bill" className="size-3.5" /> Bill
                          </a>
                        )}
                        {token && (
                          <>
                            <a href={`/api/dashboard/${ctx.org.slug}/qr/${t.id}?format=png`} className={smallLink} aria-label={`Download PNG QR for table ${t.label}`} title="Download PNG">
                              PNG
                            </a>
                            <a href={`/api/dashboard/${ctx.org.slug}/qr/${t.id}?format=svg&download=1`} className={smallLink} aria-label={`Download SVG QR for table ${t.label}`} title="Download SVG">
                              SVG
                            </a>
                            <a href={`/t/${token}`} target="_blank" rel="noreferrer" className={smallLink} data-testid="open-table-link" title="Open the guest page in a new tab">
                              <Icon name="external" className="size-3.5" /> Open
                            </a>
                          </>
                        )}
                        {canManage && <InlineAction action={rotateQrAction} fields={{ org: ctx.org.slug, tableId: t.id }} label="New QR" variant="ghost" size="sm" confirm="Create a new QR code? The old printed code will stop working." />}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    );

  return (
    <>
      <SetupStepNav orgSlug={ctx.org.slug} orgId={ctx.org.id} stepKey="tables" locationId={location.id} />
      <PageHeader
        title="Tables & QR codes"
        description="Each table has its own QR code. Guests scan it to order, with no app or login. Staff still accept every order."
        actions={
          tables.length > 0 && (
            <>
              <ButtonLink href={`${base}/tables/print`} variant="secondary" icon="print">Printable QR sheet</ButtonLink>
              <ButtonLink href={`/api/dashboard/${ctx.org.slug}/qr/sheet.pdf?location=${location.id}`} variant="secondary" icon="download" prefetch={false}>Download PDF</ButtonLink>
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
      {tables.length > 0 && (
        <div className={statGrid(3, 'mb-5')}>
          <Stat label="Tables" value={tables.length} icon="tables" />
          <Stat label="Occupied now" value={occupied} icon="users" tone={occupied > 0 ? 'lime' : undefined} />
          <Stat label="Dining areas" value={areas.length} icon="layers" />
        </div>
      )}
      {tables.length === 0 ? (
        // No tables yet: the short empty state, then the forms to add them.
        <div className="space-y-5">
          {list}
          {manage && <div className="max-w-2xl">{manage}</div>}
        </div>
      ) : (
        <div className={cn('grid items-start gap-5', manage && 'xl:grid-cols-[minmax(0,1fr)_20rem]')}>
          {list}
          {manage}
        </div>
      )}
      <p className="mt-5 flex items-start gap-2 text-xs text-muted">
        <Icon name="shield" className="mt-px size-3.5 shrink-0" />
        A QR code can be photographed and shared, so it does not prove a guest is at the table. Every table order must be accepted by staff, and orders are rate-limited.
      </p>
    </>
  );
}
