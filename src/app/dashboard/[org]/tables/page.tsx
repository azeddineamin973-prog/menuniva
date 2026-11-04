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
import { TablePinPanel } from './table-access-panel';
import { fmt } from '@/i18n/config';
import { getDashText } from '@/i18n/dash';
import { getUiText } from '@/i18n/ui';

const smallLink =
  'inline-flex h-8 items-center gap-1 rounded-lg border border-line bg-surface px-2 text-xs font-medium text-ink-2 shadow-xs hover:border-line-strong hover:text-ink pointer-coarse:h-10 pointer-coarse:px-3';

export default async function TablesPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await requireTenantPage(org, 'tables.view');
  const d = getDashText(ctx.user.preferredLanguage);
  const t = d.tables;
  const ui = getUiText(ctx.user.preferredLanguage);
  const location = await currentLocation(ctx);
  if (!location) return <Alert tone="warning">{t.noLocation}</Alert>;
  const [areas, tables] = await Promise.all([
    db.diningArea.findMany({ where: { locationId: location.id, organizationId: ctx.org.id, isActive: true }, orderBy: { sortOrder: 'asc' } }),
    listTablesForLocation(ctx, location.id),
  ]);
  const base = `/dashboard/${ctx.org.slug}`;
  const canManage = ctx.can('tables.manage');
  const canSessions = ctx.can('tables.sessions');
  const policy = location.tableOrderingPolicy;
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
    { key: 'none', name: areas.length ? t.noArea : null, list: tables.filter((t) => !t.areaId) },
  ].filter((g) => g.list.length > 0);

  const manage = canManage && (
    <div className="space-y-4 xl:sticky xl:top-20">
      <Card>
        <CardHeader title={t.addTables} icon="plus" description={t.addTablesDesc} />
        <CardBody>
          <ActionForm action={createTablesAction} submitLabel={t.createTables} resetOnSuccess successText={t.tablesCreated} testId="create-tables-form">
            <input type="hidden" name="org" value={ctx.org.slug} />
            <input type="hidden" name="locationId" value={location.id} />
            <Field label={t.labels} htmlFor="labels" hint={t.labelsHint}>
              <Input id="labels" name="labels" required placeholder="1-10" />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
              <Field label={t.diningArea} htmlFor="areaId">
                <Select id="areaId" name="areaId" defaultValue="">
                  <option value="">{t.none}</option>
                  {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </Select>
              </Field>
              <Field label={t.seats} htmlFor="seats" optionalLabel={ui.optional}>
                <Input id="seats" name="seats" type="number" min={1} max={50} />
              </Field>
            </div>
          </ActionForm>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title={t.areas} icon="layers" description={t.areasDesc} />
        <CardBody className="space-y-3">
          <ul className="flex flex-wrap gap-1.5">
            {areas.map((a) => <li key={a.id}><Badge>{a.name}</Badge></li>)}
            {areas.length === 0 && <li className="text-sm text-muted">{t.noAreas}</li>}
          </ul>
          <ActionForm action={saveAreaAction} submitLabel={t.addArea} submitVariant="secondary" resetOnSuccess className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 space-y-0">
            <input type="hidden" name="org" value={ctx.org.slug} />
            <input type="hidden" name="locationId" value={location.id} />
            <Input name="name" required placeholder={t.newArea} aria-label={t.newArea} />
          </ActionForm>
        </CardBody>
      </Card>
    </div>
  );

  const list =
    tables.length === 0 ? (
      <EmptyState icon="qr" title={t.emptyTitle} description={canManage ? t.emptyManage : t.emptyStaff} />
    ) : (
      <div className="space-y-5">
        {groups.map((g) => (
          <section key={g.key} aria-label={g.name ?? t.tablesSection}>
            {g.name && (
              <h2 className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-ink-2">
                {g.name}
                <span className="rounded-md bg-surface-2 px-1.5 text-xs font-medium text-muted tabular-nums">{g.list.length}</span>
              </h2>
            )}
            <ul className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
              {g.list.map((tb) => {
                const token = tb.qrTokens[0]?.token;
                const session = tb.sessions[0];
                return (
                  <li key={tb.id} className={cn('flex gap-3.5 rounded-[var(--radius-card)] border bg-surface p-3.5 shadow-xs', session ? 'border-accent/30' : 'border-line')} data-testid="table-card">
                    {token ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={qrImages.get(tb.id)} alt={fmt(t.qrAlt, { label: tb.label })} className="size-20 shrink-0 rounded-lg border border-line bg-white p-1" width={80} height={80} decoding="async" />
                    ) : (
                      <span className="flex size-20 shrink-0 items-center justify-center rounded-lg border border-dashed border-line text-muted" aria-hidden>
                        <Icon name="qr" className="size-6" />
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <p className="font-semibold text-ink">{fmt(t.table, { label: tb.label })}</p>
                        {!tb.isActive && <Badge tone="danger">{t.inactive}</Badge>}
                        {session ? (
                          <Badge tone="lime" dot>{t.occupied}</Badge>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs text-muted">
                            <span className="size-1.5 rounded-full bg-line-strong" aria-hidden />
                            {t.free}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted">{tb.area?.name ?? t.noArea}{tb.seats ? ` · ${fmt(t.seatsN, { n: tb.seats })}` : ''}</p>
                      {session && (
                        <p className="mt-1 text-xs text-muted" data-testid="table-session-info">
                          {fmt(t.opened, { time: session.openedAt.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' }) })}
                          {session.openedById ? '' : t.byGuest}
                          {session._count.orders > 0 && <> · <span className="font-medium text-warning">{fmt(t.waitingApproval, { n: session._count.orders })}</span></>}
                        </p>
                      )}
                      {session && policy === 'SESSION_PIN' && canSessions && (
                        <div className="mt-2">
                          <TablePinPanel org={ctx.org.slug} sessionId={session.id} locked={!!session.pinLockedAt} failures={session.pinFailedAttempts} phones={session._count.devices} testId={`table-pin-${tb.label}`} t={d.pin} />
                        </div>
                      )}
                      {!session && tb.staffTasks[0] && (
                        <p className="mt-1.5">
                          <Badge tone="warning" dot data-testid="open-request">{t.guestsAsk}</Badge>
                        </p>
                      )}
                      {!session && tb.isActive && canSessions && (
                        <div className="mt-1.5">
                          <InlineAction action={openTableAction} fields={{ org: ctx.org.slug, tableId: tb.id }} label={policy === 'SESSION_PIN' ? t.openWithPin : t.open} variant={tb.staffTasks[0] || policy !== 'OPEN' ? 'primary' : 'secondary'} testId="open-table" />
                        </div>
                      )}
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {session && ctx.can('payments.record') && (
                          <a href={`${base}/bills/${session.id}`} className={cn(smallLink, 'border-accent/30 text-ink')} data-testid="bill-link">
                            <Icon name="bill" className="size-3.5" /> {t.bill}
                          </a>
                        )}
                        {token && (
                          <>
                            <a href={`/api/dashboard/${ctx.org.slug}/qr/${tb.id}?format=png`} className={smallLink} aria-label={fmt(t.pngFor, { label: tb.label })} title={t.downloadPng}>
                              PNG
                            </a>
                            <a href={`/api/dashboard/${ctx.org.slug}/qr/${tb.id}?format=svg&download=1`} className={smallLink} aria-label={fmt(t.svgFor, { label: tb.label })} title={t.downloadSvg}>
                              SVG
                            </a>
                            <a href={`/t/${token}`} target="_blank" rel="noreferrer" className={smallLink} data-testid="open-table-link" title={t.openGuestTitle}>
                              <Icon name="external" className="size-3.5" /> {t.openGuest}
                            </a>
                          </>
                        )}
                        {canManage && <InlineAction action={rotateQrAction} fields={{ org: ctx.org.slug, tableId: tb.id }} label={t.newQr} variant="ghost" size="sm" confirm={t.newQrConfirm} />}
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
        title={t.title}
        description={t.description}
        meta={
          <ButtonLink href={`/dashboard/${ctx.org.slug}/tables/floor-plan`} variant="secondary" size="sm" icon="layers" data-testid="open-floor-plan">
            {t.floorPlan}
          </ButtonLink>
        }
        actions={
          tables.length > 0 && (
            <>
              <ButtonLink href={`${base}/tables/print`} variant="secondary" icon="print">{t.printSheet}</ButtonLink>
              <ButtonLink href={`/api/dashboard/${ctx.org.slug}/qr/sheet.pdf?location=${location.id}`} variant="secondary" icon="download" prefetch={false}>{t.downloadPdf}</ButtonLink>
            </>
          )
        }
      />
      {!location.tableOrderingEnabled && (
        <div className="mb-4">
          <Alert tone="warning" title={t.orderingOffTitle}>
            {t.orderingOff}
          </Alert>
        </div>
      )}
      {tables.length > 0 && (
        <div className={statGrid(3, 'mb-5')}>
          <Stat label={t.statTables} value={tables.length} icon="tables" />
          <Stat label={t.statOccupied} value={occupied} icon="users" tone={occupied > 0 ? 'lime' : undefined} />
          <Stat label={t.statAreas} value={areas.length} icon="layers" />
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
      <p className="mt-5 flex items-start gap-2 text-xs text-muted" data-testid="table-policy-note">
        <Icon name="shield" className="mt-px size-3.5 shrink-0" />
        {policy === 'SESSION_PIN' ? t.notePin : policy === 'SESSION' ? t.noteSession : t.noteOpen}
      </p>
    </>
  );
}
