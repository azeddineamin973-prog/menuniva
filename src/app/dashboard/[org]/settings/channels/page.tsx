import { ActionForm, FieldError } from '@/components/forms/action-form';
import { Alert, Card, CardBody, CardHeader, Checkbox, Field, Input, PageHeader } from '@/components/ui';
import { db } from '@/server/db';
import { requireTenantPage } from '@/server/tenant';
import { currentLocation } from '@/server/current-location';
import { saveChannelSettingsAction } from '../actions';
import { SettingsTabs } from '../tabs';

export default async function ChannelsPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await requireTenantPage(org, 'settings.manage');
  const location = await currentLocation(ctx);
  const review = location ? await db.reviewSettings.findUnique({ where: { locationId: location.id } }) : null;
  const base = `/dashboard/${ctx.org.slug}`;
  if (!location) return <Alert tone="warning">No location found.</Alert>;
  const link = (name: keyof typeof location, label: string, hint: string) => (
    <Field label={label} htmlFor={String(name)} hint={hint} optionalLabel="optional">
      <Input id={String(name)} name={String(name)} type="url" placeholder="https://" defaultValue={(location[name] as string | null) ?? ''} />
      <FieldError name={String(name)} />
    </Field>
  );
  return (
    <>
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
              <Checkbox name="takeawayEnabled" label="Takeaway / pickup" description="Not yet available to guests — arrives with the Takeaway module (milestone M9)." defaultChecked={location.takeawayEnabled} />
              <Checkbox name="deliveryEnabled" label="Restaurant delivery" description="Not yet available to guests — arrives with the Delivery module (milestone M9)." defaultChecked={location.deliveryEnabled} />
              <Checkbox name="reservationsEnabled" label="Reservation requests" description="Not yet available to guests — arrives with the Reservations module (milestone M10)." defaultChecked={location.reservationsEnabled} />
              <Checkbox name="whatsappOrderingEnabled" label="WhatsApp order button" description="Opens WhatsApp with a prepared message. These orders are not stored in MenuNiva." defaultChecked={location.whatsappOrderingEnabled} />
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
