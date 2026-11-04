import { ActionForm, FieldError } from '@/components/forms/action-form';
import { Alert, Card, CardBody, CardHeader, Checkbox, Field, Input, PageHeader } from '@/components/ui';
import { db } from '@/server/db';
import { requireTenantPage } from '@/server/tenant';
import { currentLocation } from '@/server/current-location';
import { SetupStepNav } from '@/components/dashboard/setup-nav';
import { unopenedTableOrders } from '@/server/services/table-access';
import { saveChannelSettingsAction } from '../actions';
import { SettingsTabs } from '../tabs';

const POLICIES = [
  { value: 'SESSION_PIN', label: 'Staff open the table and give a PIN', description: 'Guests can always see the menu. To order, each phone enters the table’s 6-digit PIN once, given by staff at the table. Closing the table ends it for every phone. Stops orders from copied QR codes and from guests who already left.' },
  { value: 'SESSION', label: 'Staff open the table, no PIN', description: 'Closed tables cannot order: tap Open when you seat guests. Anyone with the table’s QR can order while it is open.' },
  { value: 'OPEN', label: 'Anyone with the QR code (not recommended)', description: 'A copied QR code can order from anywhere, also on a free table or after the guests left. MenuNiva opens the table by itself. Staff still accept every order.' },
] as const;

export default async function ChannelsPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await requireTenantPage(org, 'settings.manage');
  const location = await currentLocation(ctx);
  const review = location ? await db.reviewSettings.findUnique({ where: { locationId: location.id } }) : null;
  const base = `/dashboard/${ctx.org.slug}`;
  if (!location) return <Alert tone="warning">No location found.</Alert>;
  const exposure = await unopenedTableOrders(ctx, location.id);
  const link = (name: keyof typeof location, label: string, hint: string) => (
    <Field label={label} htmlFor={String(name)} hint={hint} optionalLabel="optional">
      <Input id={String(name)} name={String(name)} type="url" placeholder="https://" defaultValue={(location[name] as string | null) ?? ''} />
      <FieldError name={String(name)} />
    </Field>
  );
  return (
    <>
      <SetupStepNav orgSlug={ctx.org.slug} orgId={ctx.org.id} stepKey="channels" locationId={location.id} />
      <PageHeader title="Ordering channels & links" description={`Settings for ${location.name}.`} />
      <SettingsTabs base={base} active="channels" />
      <ActionForm action={saveChannelSettingsAction} testId="channels-form">
        <input type="hidden" name="org" value={ctx.org.slug} />
        <input type="hidden" name="locationId" value={location.id} />
        <div className="grid gap-6 xl:grid-cols-2">
          <Card>
            <CardHeader title="MenuNiva ordering" description="Orders from these channels are stored in MenuNiva and appear in Live Orders. No commission is charged by MenuNiva." />
            <CardBody className="space-y-4">
              <Checkbox name="tableOrderingEnabled" label="Order at table (QR codes)" description="Guests order from their table. Staff accept each order." defaultChecked={location.tableOrderingEnabled} />
              <Checkbox name="takeawayEnabled" label="Takeaway / pickup" description="Guests choose a pickup time. Configure hours, lead time and minimum in Takeaway." defaultChecked={location.takeawayEnabled} />
              <Checkbox name="deliveryEnabled" label="Restaurant delivery" description="Delivered by your own staff. Configure postal-code zones and fees in Delivery." defaultChecked={location.deliveryEnabled} />
              <fieldset className="space-y-2 rounded-xl border border-line p-3" data-testid="table-policy">
                <legend className="px-1 text-sm font-semibold text-ink">Who can order at a table</legend>
                {POLICIES.map((p) => (
                  <label key={p.value} className="flex cursor-pointer items-start gap-2.5 rounded-lg p-2 hover:bg-surface-2">
                    <input type="radio" name="tableOrderingPolicy" value={p.value} defaultChecked={location.tableOrderingPolicy === p.value} className="mt-1 size-4 shrink-0 accent-[#7ac70c]" data-testid={`policy-${p.value}`} />
                    <span>
                      <span className="block text-sm font-medium text-ink">
                        {p.label}
                        {p.value === 'SESSION_PIN' && <span className="ms-2 rounded-md bg-accent/15 px-1.5 py-0.5 text-[11px] font-semibold text-ink">Recommended</span>}
                      </span>
                      <span className="block text-xs text-muted">{p.description}</span>
                    </span>
                  </label>
                ))}
                {location.tableOrderingPolicy === 'OPEN' && (
                  <p className="rounded-lg bg-warning/10 p-2 text-xs text-ink-2" data-testid="policy-exposure">
                    In the last 30 days, {exposure.orders === 1 ? '1 order was' : `${exposure.orders} orders were`} placed on {exposure.sessions === 1 ? '1 table' : `${exposure.sessions} tables`} that no member of staff had opened. Switching to table PINs takes effect for the next guests: tables that are open now keep working, and new tables need staff to open them.
                  </p>
                )}
                <Field label="Orders waiting for approval, per table" htmlFor="tablePendingOrderCap" hint="Further orders are refused until staff accept or reject some. Protects Live Orders from fake orders.">
                  <Input id="tablePendingOrderCap" name="tablePendingOrderCap" type="number" min={1} max={50} defaultValue={location.tablePendingOrderCap} className="max-w-28" />
                  <FieldError name="tablePendingOrderCap" />
                </Field>
              </fieldset>
              <Checkbox name="reservationsEnabled" label="Reservation requests" description="Guests request a time; you confirm in Reservations. Configure hours and capacity there." defaultChecked={location.reservationsEnabled} />
              <Checkbox name="whatsappOrderingEnabled" label="WhatsApp order button" description="Guests build an order and WhatsApp opens with a prepared message to your number. These orders are NOT stored in MenuNiva and are only sent when the guest presses send." defaultChecked={location.whatsappOrderingEnabled} />
              <div className="rounded-xl border border-warning/30 bg-warning/5 p-3">
                <Checkbox name="orderingPaused" label="Pause all online ordering now" description="Use during very busy periods. Guests can still view the menu." defaultChecked={location.orderingPaused} />
              </div>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="External links" description="Shown on your public page. Orders on Glovo or Uber Eats stay on those platforms." />
            <CardBody className="space-y-4">
              {link('glovoUrl', 'Glovo store link', 'Your restaurant page on glovoapp.com')}
              {link('uberEatsUrl', 'Uber Eats store link', 'Your restaurant page on ubereats.com')}
              {link('websiteUrl', 'Website', '')}
              {link('instagramUrl', 'Instagram', '')}
              {link('facebookUrl', 'Facebook', '')}
              {link('tiktokUrl', 'TikTok', '')}
              <Field label="Official Google review link" htmlFor="googleReviewUrl" optionalLabel="optional" hint="From your Google Business Profile → “Ask for reviews”. Shown equally to every guest after feedback.">
                <Input id="googleReviewUrl" name="googleReviewUrl" type="url" placeholder="https://g.page/r/…" defaultValue={review?.googleReviewUrl ?? ''} />
                <FieldError name="googleReviewUrl" />
              </Field>
            </CardBody>
          </Card>
        </div>
      </ActionForm>
    </>
  );
}
