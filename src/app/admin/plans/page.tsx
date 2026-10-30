import { ActionForm } from '@/components/forms/action-form';
import { Alert, Card, CardBody, CardHeader, Checkbox, Field, Input, PageHeader, Textarea } from '@/components/ui';
import { db } from '@/server/db';
import { ensureDefaultPlans } from '@/server/services/plans';
import { updatePlanAction } from '../actions';
import { requirePlatformAdminPage } from '@/server/tenant';

export const dynamic = 'force-dynamic';

export default async function PlansPage() {
  // Layout checks are not re-run on client navigation, so every admin page checks itself.
  await requirePlatformAdminPage();
  await ensureDefaultPlans();
  const plans = await db.subscriptionPlan.findMany({ orderBy: { sortOrder: 'asc' }, include: { _count: { select: { subscriptions: true } } } });
  return (
    <>
      <PageHeader title="Subscription plans" description="Plan names, prices and limits are configurable. They are not final commercial pricing." />
      <div className="mb-6">
        <Alert tone="info">Prices left empty mean “custom / not yet decided”. Billing is manual until a billing processor is configured.</Alert>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        {plans.map((p) => (
          <Card key={p.id}>
            <CardHeader title={p.name} description={`code: ${p.code} · ${p._count.subscriptions} subscriptions`} />
            <CardBody>
              <ActionForm action={updatePlanAction} submitLabel="Save plan">
                <input type="hidden" name="planId" value={p.id} />
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Name" htmlFor={`n-${p.id}`}><Input id={`n-${p.id}`} name="name" defaultValue={p.name} /></Field>
                  <Field label="Monthly price (cents, EUR)" htmlFor={`p-${p.id}`} hint="e.g. 4900 = 49,00 €"><Input id={`p-${p.id}`} name="monthlyPriceCents" inputMode="numeric" defaultValue={p.monthlyPriceCents ?? ''} /></Field>
                </div>
                <Field label="Description" htmlFor={`d-${p.id}`}><Input id={`d-${p.id}`} name="description" defaultValue={p.description ?? ''} /></Field>
                <Field label="Limits (JSON)" htmlFor={`l-${p.id}`}><Textarea id={`l-${p.id}`} name="limits" className="font-mono text-xs" defaultValue={JSON.stringify(p.limits)} /></Field>
                <p className="text-xs text-muted">Features: {p.features.join(', ')}</p>
                <Checkbox name="isActive" label="Available for new subscriptions" defaultChecked={p.isActive} />
              </ActionForm>
            </CardBody>
          </Card>
        ))}
      </div>
    </>
  );
}
