import Link from 'next/link';
import { ActionForm, FieldError } from '@/components/forms/action-form';
import { InlineAction } from '@/components/forms/inline-action';
import { OpeningHoursEditor } from '@/components/forms/opening-hours-editor';
import { Alert, Badge, Card, CardBody, CardHeader, Checkbox, Field, Input, Label, PageHeader, Select, disclosureClass, humanize } from '@/components/ui';
import { getMessages } from '@/i18n';
import type { OpeningHours } from '@/lib/opening-hours';
import { centsToInputValue, formatCents } from '@/lib/money';
import { currentLocation } from '@/server/current-location';
import { db } from '@/server/db';
import { listDrivers } from '@/server/services/fulfilment';
import { requireModulePage } from '@/server/module-page';
import { requireTenantPage } from '@/server/tenant';
import { assignDriverAction, deleteZoneAction, saveDeliverySettingsAction, saveZoneAction } from './actions';

export default async function DeliveryPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await requireTenantPage(org, 'delivery.manage');
  await requireModulePage(ctx, 'delivery');
  const location = await currentLocation(ctx);
  if (!location) return <Alert tone="warning">No location.</Alert>;
  const m = getMessages(ctx.user.preferredLanguage);
  const [settings, zones, active, drivers] = await Promise.all([
    db.deliverySettings.findUnique({ where: { locationId: location.id } }),
    db.deliveryZone.findMany({ where: { locationId: location.id, organizationId: ctx.org.id }, orderBy: [{ isActive: 'desc' }, { sortOrder: 'asc' }] }),
    db.order.findMany({ where: { organizationId: ctx.org.id, locationId: location.id, channel: 'DELIVERY', status: { in: ['NEW', 'ACCEPTED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'DELIVERED'] } }, include: { delivery: { include: { zone: true } } }, orderBy: { createdAt: 'asc' } }),
    listDrivers(ctx),
  ]);
  const pc = location.country === 'PT' ? '4700-*, 4710-001' : '280*, 28013';
  const money = (c: number | null | undefined) => (c === null || c === undefined ? '' : centsToInputValue(c));
  const zoneFields = (z?: (typeof zones)[number]) => (
    <>
      <input type="hidden" name="org" value={ctx.org.slug} />
      <input type="hidden" name="locationId" value={location.id} />
      {z && <input type="hidden" name="id" value={z.id} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Zone name" htmlFor={`zn-${z?.id ?? 'new'}`}><Input id={`zn-${z?.id ?? 'new'}`} name="name" required defaultValue={z?.name} /></Field>
        <Field label="Postal codes" htmlFor={`zp-${z?.id ?? 'new'}`} hint={`Comma separated. Exact codes or prefixes with *, e.g. ${pc}`}>
          <Input id={`zp-${z?.id ?? 'new'}`} name="patterns" required defaultValue={z?.postalCodePatterns.join(', ')} />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Fee (€)" htmlFor={`zf-${z?.id ?? 'new'}`}><Input id={`zf-${z?.id ?? 'new'}`} name="fee" inputMode="decimal" required defaultValue={money(z?.feeCents)} /><FieldError name="fee" /></Field>
        <Field label="Minimum (€)" htmlFor={`zm-${z?.id ?? 'new'}`} optionalLabel="opt."><Input id={`zm-${z?.id ?? 'new'}`} name="minOrder" inputMode="decimal" defaultValue={z?.minOrderCents ? money(z.minOrderCents) : ''} /></Field>
        <Field label="Free from (€)" htmlFor={`zl-${z?.id ?? 'new'}`} optionalLabel="opt."><Input id={`zl-${z?.id ?? 'new'}`} name="freeFrom" inputMode="decimal" defaultValue={money(z?.freeDeliveryThresholdCents)} /></Field>
        <Field label="Time (min)" htmlFor={`zt-${z?.id ?? 'new'}`} optionalLabel="opt."><Input id={`zt-${z?.id ?? 'new'}`} name="estimatedMinutes" type="number" min={1} max={300} defaultValue={z?.estimatedMinutes ?? ''} /></Field>
      </div>
    </>
  );
  return (
    <>
      <PageHeader title={m.nav.delivery} description="Your own delivery by restaurant staff. Fees are set per postal-code zone — MenuNiva does not calculate distances or dispatch Glovo/Uber couriers." />
      {location.deliveryEnabled && !settings?.deliveryHours && !location.openingHours && (
        <div className="mb-4" data-testid="no-hours-warning"><Alert tone="danger" title="No hours set">Guests can currently order delivery at any time of day. Enter delivery hours below or your opening hours in Settings.</Alert></div>
      )}
      {!location.deliveryEnabled && <div className="mb-4"><Alert tone="warning">Delivery is switched off. Turn it on in <Link className="font-medium underline underline-offset-2" href={`/dashboard/${ctx.org.slug}/settings/channels`}>Settings → Ordering channels</Link>.</Alert></div>}
      <div className="grid gap-6 xl:grid-cols-2">
        <div className="space-y-6">
          <Card>
            <CardHeader title={`Active deliveries (${active.length})`} description="Assign a driver. Drivers update the status from their phone." />
            {active.length === 0 ? (
              <CardBody className="text-sm text-muted">No active deliveries.</CardBody>
            ) : (
              <ul className="divide-y divide-line">
                {active.map((o) => (
                  <li key={o.id} className="space-y-2 px-5 py-3 text-sm" data-testid="active-delivery">
                    <div className="flex flex-wrap justify-between gap-2">
                      <span><strong>#{o.number}</strong> · {o.delivery?.addressLine}, {o.delivery?.postalCode} {o.delivery?.city}</span>
                      <span className="flex gap-2"><Badge>{humanize(o.status)}</Badge><span className="tabular-nums">{formatCents(o.totalCents)}</span></span>
                    </div>
                    <p className="text-xs text-muted">{o.delivery?.zone?.name} · {o.customerPhone} · {o.paymentMethodIntent === 'CARD_TERMINAL' ? 'card at the door' : 'cash on delivery'}{o.paymentStatus === 'PAID' ? ' · paid' : ''}</p>
                    <ActionForm action={assignDriverAction} submitLabel="Assign" submitVariant="secondary" className="flex items-center gap-2 space-y-0">
                      <input type="hidden" name="org" value={ctx.org.slug} />
                      <input type="hidden" name="orderId" value={o.id} />
                      <Select name="membershipId" defaultValue={o.delivery?.driverMembershipId ?? ''} aria-label={m.staff.assignDriver} className="h-8 w-56" data-testid="driver-select">
                        <option value="">{m.staff.unassigned}</option>
                        {drivers.map((d) => <option key={d.id} value={d.id}>{d.user.name} ({d.role.replace('RESTAURANT_', '').toLowerCase().replace('_', ' ')})</option>)}
                      </Select>
                    </ActionForm>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <CardHeader title="Delivery settings" />
            <CardBody>
              <ActionForm action={saveDeliverySettingsAction} testId="delivery-settings-form">
                <input type="hidden" name="org" value={ctx.org.slug} />
                <input type="hidden" name="locationId" value={location.id} />
                <div className="grid gap-4 sm:grid-cols-3">
                  <Field label="Preparation (min)" htmlFor="prep"><Input id="prep" name="prepEstimateMinutes" type="number" min={0} defaultValue={settings?.prepEstimateMinutes ?? 25} /></Field>
                  <Field label="Travel (min)" htmlFor="trav"><Input id="trav" name="deliveryEstimateMinutes" type="number" min={0} defaultValue={settings?.deliveryEstimateMinutes ?? 30} /></Field>
                  <Field label="Max active orders" htmlFor="max"><Input id="max" name="maxActiveOrders" type="number" min={1} defaultValue={settings?.maxActiveOrders ?? 10} /></Field>
                </div>
                <Checkbox name="cashOnDeliveryEnabled" label="Accept cash on delivery" defaultChecked={settings?.cashOnDeliveryEnabled ?? true} />
                <Checkbox name="cardOnDeliveryEnabled" label="Accept card at the door (your own terminal)" defaultChecked={settings?.cardOnDeliveryEnabled ?? false} />
                <div className="rounded-xl border border-warning/30 bg-warning/5 p-3"><Checkbox name="paused" label="Pause delivery now" defaultChecked={settings?.paused ?? false} /></div>
                <div>
                  <Label>Delivery hours</Label>
                  <p className="mb-2 text-xs text-muted">Leave empty to use your opening hours.</p>
                  <OpeningHoursEditor name="deliveryHours" inheritsFrom="opening hours" initial={(settings?.deliveryHours as OpeningHours | null) ?? null} />
                </div>
              </ActionForm>
            </CardBody>
          </Card>
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Delivery zones" description={`Postal codes: ${location.country === 'PT' ? 'Portugal 0000-000' : 'Spain 00000'}. Guests outside every zone are offered pickup instead.`} />
            <ul className="divide-y divide-line">
              {zones.map((z) => (
                <li key={z.id} className="space-y-2 px-5 py-4" data-testid="zone">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span className="font-medium">{z.name} {!z.isActive && <Badge tone="danger">Inactive</Badge>}</span>
                    <span className="text-muted">{formatCents(z.feeCents)}{z.minOrderCents ? ` · min ${formatCents(z.minOrderCents)}` : ''}{z.freeDeliveryThresholdCents !== null ? ` · free from ${formatCents(z.freeDeliveryThresholdCents)}` : ''}</span>
                  </div>
                  <details>
                    <summary className={disclosureClass}>Edit · {z.postalCodePatterns.join(', ')}</summary>
                    <ActionForm action={saveZoneAction} submitLabel="Save zone" submitVariant="secondary" className="mt-2">
                      {zoneFields(z)}
                      <Checkbox name="isActive" label="Active" defaultChecked={z.isActive} />
                    </ActionForm>
                  </details>
                  {z.isActive && <InlineAction action={deleteZoneAction} fields={{ org: ctx.org.slug, id: z.id }} label="Deactivate" variant="ghost" />}
                </li>
              ))}
              {zones.length === 0 && <li className="px-5 py-4 text-sm text-muted">No zones yet — guests cannot order delivery until you add one.</li>}
            </ul>
            <CardBody className="border-t border-line">
              <ActionForm action={saveZoneAction} submitLabel="Add zone" resetOnSuccess testId="add-zone-form">
                {zoneFields()}
              </ActionForm>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
