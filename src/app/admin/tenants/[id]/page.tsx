import { notFound } from 'next/navigation';
import { ActionForm } from '@/components/forms/action-form';
import { Badge, Card, CardBody, CardHeader, Checkbox, Field, Input, PageHeader, Select } from '@/components/ui';
import { db } from '@/server/db';
import { MODULES } from '@/server/services/admin';
import { setModulesAction, setTenantStatusAction, updateSubscriptionAction } from '../../actions';

export const dynamic = 'force-dynamic';

const d = (x: Date | null | undefined) => (x ? x.toISOString().slice(0, 10) : '');

export default async function TenantDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const org = await db.restaurantOrganization.findUnique({
    where: { id },
    include: {
      subscription: { include: { plan: true } },
      locations: true,
      memberships: { include: { user: { select: { email: true, name: true } } } },
      _count: { select: { products: true, orders: true, feedback: true } },
    },
  });
  if (!org) notFound();
  const [plans, logs] = await Promise.all([
    db.subscriptionPlan.findMany({ orderBy: { sortOrder: 'asc' } }),
    db.auditLog.findMany({ where: { organizationId: org.id }, orderBy: { createdAt: 'desc' }, take: 25 }),
  ]);
  const sub = org.subscription;
  return (
    <>
      <PageHeader title={org.name} description={`/${org.slug} · ${org.country} · created ${d(org.createdAt)}`} actions={<Badge tone={org.status === 'ACTIVE' ? 'success' : org.status === 'SUSPENDED' ? 'danger' : 'info'}>{org.status}</Badge>} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Account status" description="Suspending blocks dashboard access and public ordering. Data is kept." />
          <CardBody>
            <ActionForm action={setTenantStatusAction} submitLabel="Update status">
              <input type="hidden" name="organizationId" value={org.id} />
              <Field label="Status" htmlFor="status">
                <Select id="status" name="status" defaultValue={org.status}>
                  <option value="ONBOARDING">Onboarding</option>
                  <option value="ACTIVE">Active</option>
                  <option value="SUSPENDED">Suspended</option>
                  <option value="ARCHIVED">Archived</option>
                </Select>
              </Field>
              <Field label="Reason (required for suspension)" htmlFor="reason">
                <Input id="reason" name="reason" maxLength={500} />
              </Field>
            </ActionForm>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Subscription (manual)" description="No billing processor is connected. Changes here are recorded in the audit log." />
          <CardBody>
            <ActionForm action={updateSubscriptionAction} submitLabel="Save subscription">
              <input type="hidden" name="organizationId" value={org.id} />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Plan" htmlFor="planId">
                  <Select id="planId" name="planId" defaultValue={sub?.planId}>
                    {plans.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Status" htmlFor="sstatus">
                  <Select id="sstatus" name="status" defaultValue={sub?.status ?? 'TRIALING'}>
                    {['TRIALING', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED'].map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Billing period" htmlFor="billingPeriod">
                  <Select id="billingPeriod" name="billingPeriod" defaultValue={sub?.billingPeriod ?? 'MONTHLY'}>
                    <option value="MONTHLY">Monthly</option>
                    <option value="YEARLY">Yearly</option>
                  </Select>
                </Field>
                <Field label="Trial ends" htmlFor="trialEndsAt">
                  <Input id="trialEndsAt" name="trialEndsAt" type="date" defaultValue={d(sub?.trialEndsAt)} />
                </Field>
                <Field label="Current period ends" htmlFor="currentPeriodEnd">
                  <Input id="currentPeriodEnd" name="currentPeriodEnd" type="date" defaultValue={d(sub?.currentPeriodEnd)} />
                </Field>
              </div>
            </ActionForm>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Feature modules" description="Extra modules enabled for this tenant in addition to its plan." />
          <CardBody>
            <ActionForm action={setModulesAction} submitLabel="Save modules">
              <input type="hidden" name="organizationId" value={org.id} />
              <div className="grid gap-2 sm:grid-cols-2">
                {MODULES.map((m) => (
                  <Checkbox key={m} name="modules" value={m} label={m.replace('_', ' ')} defaultChecked={org.enabledModules.includes(m)} description={sub?.plan.features.includes(m) ? 'Included in plan' : undefined} />
                ))}
              </div>
            </ActionForm>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Usage" description="Aggregate counts only." />
          <CardBody className="grid grid-cols-3 gap-4 text-sm">
            <div><p className="text-muted">Products</p><p className="text-xl font-semibold">{org._count.products}</p></div>
            <div><p className="text-muted">Orders</p><p className="text-xl font-semibold">{org._count.orders}</p></div>
            <div><p className="text-muted">Feedback entries</p><p className="text-xl font-semibold">{org._count.feedback}</p></div>
            <div className="col-span-3">
              <p className="mb-1 text-muted">Staff</p>
              <ul className="space-y-1">
                {org.memberships.map((m) => (
                  <li key={m.id} className="flex justify-between">
                    <span>{m.user.name} · {m.user.email}</span>
                    <Badge>{m.role}</Badge>
                  </li>
                ))}
              </ul>
            </div>
          </CardBody>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader title="Recent audit log" />
        <ul className="divide-y divide-line text-sm">
          {logs.map((l) => (
            <li key={l.id} className="flex flex-wrap justify-between gap-2 px-5 py-2.5">
              <span className="font-mono text-xs">{l.action}</span>
              <span className="text-xs text-muted">{l.createdAt.toISOString().replace('T', ' ').slice(0, 19)} UTC</span>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
