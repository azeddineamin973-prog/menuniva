import { ActionForm } from '@/components/forms/action-form';
import { Alert, Card, CardBody, CardHeader, Field, Input, PageHeader } from '@/components/ui';
import { db } from '@/server/db';
import { requireTenantPage } from '@/server/tenant';
import { eraseGuestDataAction, findGuestDataAction, saveRetentionAction } from '../actions';
import { SettingsTabs } from '../tabs';
import { PrivacyTools } from './privacy-tools';

export default async function PrivacyPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await requireTenantPage(org, 'settings.manage');
  const settings = await db.restaurantSettings.findUnique({ where: { organizationId: ctx.org.id } });
  return (
    <>
      <PageHeader title="Privacy (GDPR)" description="Answer guests' requests to see or delete their data, and decide how long contact details are kept." />
      <SettingsTabs base={`/dashboard/${ctx.org.slug}`} active="privacy" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Guest data request" description="Search everything linked to a phone number or email: orders, deliveries, reservations, feedback follow-ups and loyalty membership." />
          <CardBody>
            <PrivacyTools org={ctx.org.slug} find={findGuestDataAction} erase={eraseGuestDataAction} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Retention" />
          <CardBody className="space-y-4">
            <ActionForm action={saveRetentionAction} testId="retention-form">
              <input type="hidden" name="org" value={ctx.org.slug} />
              <Field label="Keep guest contact details for (days)" htmlFor="rt-days" hint="30–3650 days. After this, names, phones, addresses and notes of finished orders and past reservations are erased automatically, follow-up contacts are removed from feedback, and loyalty members without activity are deleted.">
                <Input id="rt-days" name="days" type="number" min={30} max={3650} defaultValue={settings?.dataRetentionDays ?? 730} />
              </Field>
            </ActionForm>
            <Alert tone="info">Order amounts and dishes are kept for accounting. Check your legal retention duties with your accountant; MenuNiva receipts are not legal invoices.</Alert>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
