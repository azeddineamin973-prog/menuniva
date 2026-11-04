import Link from 'next/link';
import { ActionForm, FieldError } from '@/components/forms/action-form';
import { InlineAction } from '@/components/forms/inline-action';
import { OpeningHoursEditor } from '@/components/forms/opening-hours-editor';
import { Alert, Badge, Card, CardBody, CardHeader, Checkbox, EmptyState, Field, Icon, Input, Label, PageHeader, Select, disclosureClass, type IconName } from '@/components/ui';
import { getMessages } from '@/i18n';
import { fmt } from '@/i18n/config';
import { cn } from '@/lib/cn';
import type { OpeningHours } from '@/lib/opening-hours';
import { centsToInputValue, formatCents } from '@/lib/money';
import { currentLocation } from '@/server/current-location';
import { db } from '@/server/db';
import { locationDrivers } from '@/server/services/fulfilment';
import { requireModulePage } from '@/server/module-page';
import { requireTenantPage } from '@/server/tenant';
import { describeZonePattern, parseZoneEntry, zonePatternInput, zonePatternKind } from '@/lib/postal';
import { deleteZoneAction, saveDeliverySettingsAction, saveZoneAction } from './actions';
import { AddressTester, AreasInput } from './zone-tools';

const TABS = ['active', 'zones', 'settings'] as const;
type Tab = (typeof TABS)[number];

/**
 * The restaurant's own delivery, in three tabs: what is on its way now (assign drivers), where
 * the restaurant delivers (zones by postal area, town or everywhere, with their fees), and how (hours, payment, limits).
 */
export default async function DeliveryPage({ params, searchParams }: { params: Promise<{ org: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { org } = await params;
  const sp = await searchParams;
  const tab: Tab = TABS.includes(sp.tab as Tab) ? (sp.tab as Tab) : 'active';
  const ctx = await requireTenantPage(org, 'delivery.manage');
  await requireModulePage(ctx, 'delivery');
  const location = await currentLocation(ctx);
  if (!location) return <Alert tone="warning">No location.</Alert>;
  const m = getMessages(ctx.user.preferredLanguage);
  const t = m.staff;
  const [settings, zones, active, drivers] = await Promise.all([
    db.deliverySettings.findUnique({ where: { locationId: location.id } }),
    db.deliveryZone.findMany({ where: { locationId: location.id, organizationId: ctx.org.id }, orderBy: [{ isActive: 'desc' }, { sortOrder: 'asc' }] }),
    db.order.findMany({ where: { organizationId: ctx.org.id, locationId: location.id, channel: 'DELIVERY', status: { in: ['NEW', 'ACCEPTED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'DELIVERED'] } }, include: { delivery: { include: { zone: true, driver: { include: { user: { select: { name: true } } } } } } }, orderBy: { createdAt: 'asc' } }),
    locationDrivers(ctx.org.id, location.id),
  ]);
  const activeZones = zones.filter((z) => z.isActive);
  const inactiveZones = zones.filter((z) => !z.isActive);
  // One-tap areas from the restaurant's own address: its postal area, its town, or everywhere.
  const pt = location.country === 'PT';
  const ownArea = location.postalCode ? parseZoneEntry(location.country, location.postalCode.replace(/\D/g, '').slice(0, pt ? 4 : 3)) : null;
  const suggestions = [
    ...(ownArea ? [{ label: `${describeZonePattern(location.country, ownArea)} area`, value: zonePatternInput(ownArea) }] : []),
    ...(location.city ? [{ label: `Town: ${location.city}`, value: location.city }] : []),
    { label: 'Everywhere', value: '*' },
  ];
  const areasHint = (
    <>
      Separate with commas. <b className="font-medium text-ink-2">{pt ? '4700' : '280'}</b> = every {pt ? '4700-xxx' : '280xx'} code · <b className="font-medium text-ink-2">{location.city ?? (pt ? 'Braga' : 'Madrid')}</b> = the whole town (the town the guest types) · <b className="font-medium text-ink-2">{pt ? '4700-123' : '28013'}</b> = one exact code · <b className="font-medium text-ink-2">*</b> = everywhere.
    </>
  );
  const money = (c: number | null | undefined) => (c === null || c === undefined ? '' : centsToInputValue(c));
  const base = `/dashboard/${ctx.org.slug}/delivery`;
  const tabs: { key: Tab; label: string; icon: IconName; count?: number }[] = [
    { key: 'active', label: t.tabActive, icon: 'truck', count: active.length },
    { key: 'zones', label: t.tabZones, icon: 'map', count: activeZones.length },
    { key: 'settings', label: t.tabSettings, icon: 'settings' },
  ];

  const zoneFields = (z?: (typeof zones)[number]) => (
    <>
      <input type="hidden" name="org" value={ctx.org.slug} />
      <input type="hidden" name="locationId" value={location.id} />
      {z && <input type="hidden" name="id" value={z.id} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Zone name" htmlFor={`zn-${z?.id ?? 'new'}`}>
          <Input id={`zn-${z?.id ?? 'new'}`} name="name" required defaultValue={z?.name} placeholder={location.city ? `e.g. ${location.city} centre` : 'e.g. City centre'} />
        </Field>
        <Field label="Fee (€)" htmlFor={`zf-${z?.id ?? 'new'}`}>
          <Input id={`zf-${z?.id ?? 'new'}`} name="fee" inputMode="decimal" required defaultValue={money(z?.feeCents)} placeholder="2,50" />
          <FieldError name="fee" />
        </Field>
      </div>
      <Field label="Areas" htmlFor={`zp-${z?.id ?? 'new'}`} hint={areasHint}>
        <AreasInput id={`zp-${z?.id ?? 'new'}`} defaultValue={z?.postalCodePatterns.map(zonePatternInput).join(', ')} suggestions={suggestions} />
      </Field>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Minimum (€)" htmlFor={`zm-${z?.id ?? 'new'}`} optionalLabel="opt.">
          <Input id={`zm-${z?.id ?? 'new'}`} name="minOrder" inputMode="decimal" defaultValue={z?.minOrderCents ? money(z.minOrderCents) : ''} />
        </Field>
        <Field label="Free from (€)" htmlFor={`zl-${z?.id ?? 'new'}`} optionalLabel="opt.">
          <Input id={`zl-${z?.id ?? 'new'}`} name="freeFrom" inputMode="decimal" defaultValue={money(z?.freeDeliveryThresholdCents)} />
        </Field>
        <Field label="Time (min)" htmlFor={`zt-${z?.id ?? 'new'}`} optionalLabel="opt.">
          <Input id={`zt-${z?.id ?? 'new'}`} name="estimatedMinutes" type="number" min={1} max={300} defaultValue={z?.estimatedMinutes ?? ''} />
        </Field>
      </div>
    </>
  );
  const zoneRow = (z: (typeof zones)[number]) => (
    <li key={z.id} className="space-y-2 px-5 py-4" data-testid="zone">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-semibold text-ink">
            {z.name}
            {!z.isActive && <Badge tone="danger">Inactive</Badge>}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1" data-testid="zone-areas">
            {z.postalCodePatterns.map((x) => (
              <span key={x} className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-1.5 py-0.5 text-xs text-ink-2">
                <Icon name={zonePatternKind(x) === 'town' ? 'building' : zonePatternKind(x) === 'everywhere' ? 'globe' : 'map'} className="size-3" />
                {describeZonePattern(location.country, x)}
              </span>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5 text-xs">
          <Badge tone="neutral">{fmt(t.zoneFee, { amount: formatCents(z.feeCents) })}</Badge>
          {z.minOrderCents > 0 && <Badge tone="neutral">{fmt(t.zoneMin, { amount: formatCents(z.minOrderCents) })}</Badge>}
          {z.freeDeliveryThresholdCents !== null && <Badge tone="success">{fmt(t.zoneFree, { amount: formatCents(z.freeDeliveryThresholdCents) })}</Badge>}
          {z.estimatedMinutes && <Badge tone="neutral">{z.estimatedMinutes} min</Badge>}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <details className="min-w-0 flex-1">
          <summary className={disclosureClass}>{m.common.edit}</summary>
          <ActionForm action={saveZoneAction} submitLabel="Save zone" submitVariant="secondary" className="mt-3">
            {zoneFields(z)}
            <Checkbox name="isActive" label="Active" defaultChecked={z.isActive} />
          </ActionForm>
        </details>
        {z.isActive && <InlineAction action={deleteZoneAction} fields={{ org: ctx.org.slug, id: z.id }} label="Deactivate" variant="ghost" />}
      </div>
    </li>
  );

  return (
    <>
      <PageHeader title={m.nav.delivery} description="Your own delivery by restaurant staff. Set one price per area: a postal area, a whole town, or everywhere. MenuNiva does not calculate distances or dispatch Glovo/Uber couriers." />
      {location.deliveryEnabled && !settings?.deliveryHours && !location.openingHours && (
        <div className="mb-4" data-testid="no-hours-warning">
          <Alert tone="danger" title="No hours set">
            Guests can currently order delivery at any time of day. Enter delivery hours in Settings or your opening hours in the restaurant settings.
          </Alert>
        </div>
      )}
      {!location.deliveryEnabled && (
        <div className="mb-4">
          <Alert tone="warning">
            Delivery is switched off. Turn it on in{' '}
            <Link className="font-medium underline underline-offset-2" href={`/dashboard/${ctx.org.slug}/settings/channels`}>
              Settings → Ordering channels
            </Link>
            .
          </Alert>
        </div>
      )}
      {settings?.paused && (
        <div className="mb-4">
          <Alert tone="warning">Delivery is paused: guests cannot order it until you switch the pause off in Settings.</Alert>
        </div>
      )}

      <nav className="mn-scroll -mx-4 mb-5 overflow-x-auto px-4" aria-label={m.nav.delivery} data-testid="delivery-tabs">
        <div className="flex w-max gap-1 rounded-xl bg-surface-2 p-1">
          {tabs.map((x) => (
            <Link
              key={x.key}
              href={x.key === 'active' ? base : `${base}?tab=${x.key}`}
              aria-current={tab === x.key ? 'page' : undefined}
              className={cn('flex h-10 items-center gap-2 rounded-lg px-4 text-sm font-semibold whitespace-nowrap transition-colors', tab === x.key ? 'bg-surface text-ink shadow-xs' : 'text-ink-2 hover:text-ink')}
              data-testid={`delivery-tab-${x.key}`}
            >
              <Icon name={x.icon} className="size-4" />
              {x.label}
              {x.count !== undefined && <span className="rounded-md bg-black/5 px-1.5 text-xs tabular-nums dark:bg-white/10">{x.count}</span>}
            </Link>
          ))}
        </div>
      </nav>

      {tab === 'active' && (
        <div className="max-w-3xl">
          {active.length === 0 ? (
            <EmptyState icon="truck" title={t.noActive} />
          ) : (
            <ul className="space-y-3">
              {active.map((o) => (
                <li key={o.id} className="rounded-xl bg-surface p-4 shadow-xs ring-1 ring-line" data-testid="active-delivery">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2">
                        <span className="text-lg font-bold tabular-nums">#{o.number}</span>
                        <Badge tone={o.status === 'OUT_FOR_DELIVERY' ? 'info' : o.status === 'READY' ? 'lime' : 'neutral'} dot>
                          {m.orderStatus[o.status as keyof typeof m.orderStatus] ?? o.status}
                        </Badge>
                      </p>
                      <p className="mt-1 font-medium text-ink">{o.delivery?.addressLine}</p>
                      <p className="text-[13px] text-muted">
                        {o.delivery?.postalCode} {o.delivery?.city} · {o.delivery?.zone?.name} · {o.customerPhone}
                      </p>
                    </div>
                    <div className="text-end">
                      <p className="font-bold tabular-nums">{formatCents(o.totalCents)}</p>
                      <p className="text-xs text-muted">{o.paymentStatus === 'PAID' ? t.paid : o.paymentMethodIntent === 'CARD_TERMINAL' ? t.payCard : t.payCash}</p>
                    </div>
                  </div>
                  <p className="mt-3 flex items-center gap-1.5 text-sm text-ink-2" data-testid="active-driver">
                    <Icon name="truck" className="size-4 text-info" />
                    {o.delivery?.driver ? fmt(t.driverNamed, { name: o.delivery.driver.user.name }) : drivers.length ? t.driverAnyone : t.noDrivers}
                  </p>
                </li>
              ))}
            </ul>
          )}
          {drivers.length === 0 && (
            <p className="mt-4 text-sm text-muted" data-testid="no-drivers-note">
              {t.noDrivers}: staff mark deliveries as out and delivered on Live Orders. Add delivery staff to send orders to their phone automatically.{' '}
              <Link href={`/dashboard/${ctx.org.slug}/staff`} className="font-medium text-ink underline underline-offset-2">
                {m.nav.staff ?? 'Staff'}
              </Link>
            </p>
          )}
        </div>
      )}

      {tab === 'zones' && (
        <div className="grid max-w-5xl gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:items-start">
          <Card>
            <CardHeader title={`${t.tabZones} (${activeZones.length})`} description="When an address fits several zones, the most precise one counts: exact code, then postal area, then town, then everywhere. Guests outside every zone are offered pickup instead." />
            <ul className="divide-y divide-line">
              {activeZones.map(zoneRow)}
              {activeZones.length === 0 && <li className="px-5 py-4 text-sm text-muted">No zones yet: guests cannot order delivery until you add one. The quickest start is one zone for “Everywhere” with a single fee.</li>}
            </ul>
            {inactiveZones.length > 0 && (
              <details className="border-t border-line">
                <summary className={cn(disclosureClass, 'px-5 py-3')}>{fmt(t.inactiveZones, { n: inactiveZones.length })}</summary>
                <ul className="divide-y divide-line border-t border-line">{inactiveZones.map(zoneRow)}</ul>
              </details>
            )}
          </Card>
          <div className="space-y-6">
            <Card>
              <CardHeader title={t.addZone} />
              <CardBody>
                {/* Keyed by the zone count: the areas field (client state) starts empty after each add. */}
                <ActionForm key={zones.length} action={saveZoneAction} submitLabel="Add zone" resetOnSuccess testId="add-zone-form">
                  {zoneFields()}
                </ActionForm>
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Test an address" description="The zone and fee a guest at this address gets at checkout." />
              <CardBody>
                <AddressTester org={ctx.org.slug} locationId={location.id} country={location.country} cityHint={location.city} />
              </CardBody>
            </Card>
          </div>
        </div>
      )}

      {tab === 'settings' && (
        <div className="max-w-3xl space-y-6">
        <Card data-testid="drivers-card">
          <CardHeader title="Who receives deliveries" description="Set once. Every delivery order goes straight to these drivers' phones (My deliveries): nobody assigns orders. The kitchen marks it ready, staff hand it over, and the driver confirms pickup, then delivery." />
          <CardBody>
            {drivers.length === 0 ? (
              <p className="text-sm text-muted">
                No delivery staff yet. Invite them on the{' '}
                <Link href={`/dashboard/${ctx.org.slug}/staff`} className="font-medium text-ink underline underline-offset-2">
                  Staff page
                </Link>{' '}
                with the role “Delivery staff”. Until then, staff mark deliveries on Live Orders.
              </p>
            ) : (
              <>
                <ul className="divide-y divide-line rounded-lg ring-1 ring-line">
                  {drivers.map((d) => (
                    <li key={d.id} className="flex items-center gap-3 px-3.5 py-2.5 text-sm" data-testid="location-driver">
                      <span className="flex size-8 items-center justify-center rounded-full bg-info/10 text-xs font-semibold text-info" aria-hidden>
                        {d.user.name.trim().slice(0, 1).toUpperCase()}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-medium text-ink">{d.user.name}</span>
                      <Badge tone="success" dot>Receives orders</Badge>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-xs text-muted">
                  {drivers.length === 1 ? 'One driver: every delivery is theirs as soon as it is placed.' : 'Several drivers: each new delivery shows on all their phones; the first to confirm pickup takes it.'} To add or remove someone, change their role on the{' '}
                  <Link href={`/dashboard/${ctx.org.slug}/staff`} className="font-medium text-ink underline underline-offset-2">
                    Staff page
                  </Link>
                  .
                </p>
              </>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Delivery settings" />
          <CardBody>
            <ActionForm action={saveDeliverySettingsAction} testId="delivery-settings-form" stickySubmit>
              <input type="hidden" name="org" value={ctx.org.slug} />
              <input type="hidden" name="locationId" value={location.id} />
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Preparation (min)" htmlFor="prep">
                  <Input id="prep" name="prepEstimateMinutes" type="number" min={0} defaultValue={settings?.prepEstimateMinutes ?? 25} />
                </Field>
                <Field label="Travel (min)" htmlFor="trav">
                  <Input id="trav" name="deliveryEstimateMinutes" type="number" min={0} defaultValue={settings?.deliveryEstimateMinutes ?? 30} />
                </Field>
                <Field label="Max active orders" htmlFor="max">
                  <Input id="max" name="maxActiveOrders" type="number" min={1} defaultValue={settings?.maxActiveOrders ?? 10} />
                </Field>
              </div>
              <div className="space-y-2">
                <Checkbox name="cashOnDeliveryEnabled" label="Accept cash on delivery" defaultChecked={settings?.cashOnDeliveryEnabled ?? true} />
                <Checkbox name="cardOnDeliveryEnabled" label="Accept card at the door (your own terminal)" defaultChecked={settings?.cardOnDeliveryEnabled ?? false} />
              </div>
              <div className="rounded-xl border border-warning/30 bg-warning/5 p-3">
                <Checkbox name="paused" label="Pause delivery now" defaultChecked={settings?.paused ?? false} />
              </div>
              <div>
                <Label>Delivery hours</Label>
                <p className="mb-2 text-xs text-muted">Leave empty to use your opening hours.</p>
                <OpeningHoursEditor name="deliveryHours" inheritsFrom="opening hours" initial={(settings?.deliveryHours as OpeningHours | null) ?? null} />
              </div>
            </ActionForm>
          </CardBody>
        </Card>
        </div>
      )}
    </>
  );
}
