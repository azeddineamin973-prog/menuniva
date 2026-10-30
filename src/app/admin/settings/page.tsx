import { ActionForm } from '@/components/forms/action-form';
import { Card, CardBody, CardHeader, Checkbox, Field, Input, PageHeader } from '@/components/ui';
import { getBillingProvider } from '@/server/billing';
import { getPlatformConfig } from '@/server/services/platform-config';
import { requirePlatformAdminPage } from '@/server/tenant';
import { updatePlatformConfigAction } from '../actions';

export const dynamic = 'force-dynamic';

export default async function PlatformSettingsPage() {
  await requirePlatformAdminPage();
  const c = await getPlatformConfig();
  const billing = getBillingProvider().status();
  return (
    <>
      <PageHeader title="Platform settings" description="Changes apply immediately and are recorded in the audit log." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Registration & trials" />
          <CardBody>
            <ActionForm action={updatePlatformConfigAction} testId="platform-config-form">
              <Checkbox name="signupsOpen" label="Restaurants can register themselves" description="When off, only Super Admin can create restaurants. Invited staff can still join." defaultChecked={c.signupsOpen} />
              <Field label="Trial length for new restaurants (days)" htmlFor="pc-trial" hint="Applies to restaurants created from now on.">
                <Input id="pc-trial" name="defaultTrialDays" type="number" min={0} max={365} defaultValue={c.defaultTrialDays} />
              </Field>
              <Checkbox name="trialIncludesAllModules" label="Trials include every module" description="When off, trialing restaurants only get their plan's modules." defaultChecked={c.trialIncludesAllModules} />
              <Field label="Support email shown to restaurants" htmlFor="pc-support" optionalLabel="optional">
                <Input id="pc-support" name="supportEmail" type="email" defaultValue={c.supportEmail ?? ''} />
              </Field>
            </ActionForm>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="SaaS billing" />
          <CardBody className="space-y-2 text-sm">
            <p><span className="font-medium">Mode:</span> <span data-testid="billing-mode">{billing.mode}</span></p>
            <p className="text-muted">{billing.note}</p>
            <p className="text-muted">Processor webhooks (<code>/api/billing/webhook</code>) are refused until a processor is integrated and its signatures are verified.</p>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
