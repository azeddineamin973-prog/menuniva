import Link from 'next/link';
import { ActionForm, FieldError } from '@/components/forms/action-form';
import { OpeningHoursEditor } from '@/components/forms/opening-hours-editor';
import { Alert, Badge, Card, CardBody, CardHeader, Checkbox, Field, Input, Label, PageHeader, Select } from '@/components/ui';
import { getMessages } from '@/i18n';
import type { OpeningHours } from '@/lib/opening-hours';
import { centsToInputValue, formatCents } from '@/lib/money';
import { formatTimeInZone, startOfDayInZone } from '@/lib/time';
import { currentLocation } from '@/server/current-location';
import { db } from '@/server/db';
import { pickupOptions } from '@/server/services/fulfilment';
import { requireModulePage } from '@/server/module-page';
import { requireTenantPage } from '@/server/tenant';
import { saveTakeawaySettingsAction } from '../delivery/actions';

export default async function TakeawayPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await requireTenantPage(org, 'takeaway.manage');
  await requireModulePage(ctx, 'takeaway');
  const location = await currentLocation(ctx);
  if (!location) return <Alert tone="warning">No location.</Alert>;
  const m = getMessages(ctx.user.preferredLanguage);
  const [settings, orders] = await Promise.all([
    db.takeawaySettings.findUnique({ where: { locationId: location.id } }),
    db.order.findMany({ where: { organizationId: ctx.org.id, locationId: location.id, channel: 'TAKEAWAY', createdAt: { gte: startOfDayInZone(new Date(), location.timeZone) } }, orderBy: { pickupAt: 'asc' } }),
  ]);
  const opts = pickupOptions(location, settings);
  return (
    <>
      <PageHeader title={m.nav.takeaway} description="Guests order ahead and collect at the counter. Payment is taken at pickup." />
      {!location.takeawayEnabled && <div className="mb-4"><Alert tone="warning">Takeaway is switched off. Turn it on in <Link className="underline" href={`/dashboard/${ctx.org.slug}/settings/channels`}>Settings → Ordering channels</Link>.</Alert></div>}
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Pickup settings" description={`Today: ${opts.asap.allowed ? 'as soon as possible available' : 'no immediate pickup'} · ${opts.slots.length} pickup times left.`} />
          <CardBody>
            <ActionForm action={saveTakeawaySettingsAction} testId="takeaway-settings-form">
              <input type="hidden" name="org" value={ctx.org.slug} />
              <input type="hidden" name="locationId" value={location.id} />
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Preparation lead time (min)" htmlFor="lead"><Input id="lead" name="leadTimeMinutes" type="number" min={0} max={240} defaultValue={settings?.leadTimeMinutes ?? 20} /></Field>
                <Field label="Time slot step" htmlFor="slot">
                  <Select id="slot" name="slotMinutes" defaultValue={String(settings?.slotMinutes ?? 15)}>
                    {[5, 10, 15, 20, 30, 60].map((n) => <option key={n} value={n}>{n} min</option>)}
                  </Select>
                </Field>
                <Field label="Minimum order (€)" htmlFor="min" optionalLabel="optional"><Input id="min" name="minOrder" inputMode="decimal" defaultValue={settings?.minOrderCents ? centsToInputValue(settings.minOrderCents) : ''} /><FieldError name="minOrder" /></Field>
              </div>
              <div className="rounded-xl border border-warning/30 bg-warning/5 p-3"><Checkbox name="paused" label="Pause takeaway now (busy period)" defaultChecked={settings?.paused ?? false} /></div>
              <div>
                <Label>Pickup hours</Label>
                <p className="mb-2 text-xs text-muted">Leave empty to use your opening hours{location.openingHours ? '' : ' (not set either — guests can then only choose “as soon as possible”)'}.</p>
                <OpeningHoursEditor name="pickupHours" initial={(settings?.pickupHours as OpeningHours | null) ?? null} />
              </div>
            </ActionForm>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Today’s pickups" />
          {orders.length === 0 ? (
            <CardBody className="text-sm text-muted">No takeaway orders today.</CardBody>
          ) : (
            <ul className="divide-y divide-line">
              {orders.map((o) => (
                <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                  <span><strong>#{o.number}</strong> · {o.customerName} · {o.customerPhone}</span>
                  <span className="flex items-center gap-2">
                    {o.pickupAt && <Badge tone="dark">{formatTimeInZone(o.pickupAt, location.timeZone)}</Badge>}
                    <Badge>{o.status.toLowerCase()}</Badge>
                    <span className="tabular-nums">{formatCents(o.totalCents)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
