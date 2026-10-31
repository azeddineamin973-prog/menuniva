import { notFound } from 'next/navigation';
import { ActionForm } from '@/components/forms/action-form';
import { Badge, Card, CardBody, CardHeader, Checkbox, Field, Input, PageHeader, Select, humanize } from '@/components/ui';
import { db } from '@/server/db';
import { orgModules } from '@/server/modules';
import { MODULE_LABELS, MODULES } from '@/lib/modules';
import { InlineAction } from '@/components/forms/inline-action';
import { formatCents } from '@/lib/money';
import { decidePlanChangeAction, recordBillingAction, setModulesAction, setTenantStatusAction, updateSubscriptionAction, voidBillingAction } from '../../actions';
import { requirePlatformAdminPage } from '@/server/tenant';

export const dynamic = 'force-dynamic';

const d = (x: Date | null | undefined) => (x ? x.toISOString().slice(0, 10) : '');

export default async function TenantDetail({ params }: { params: Promise<{ id: string }> }) {
  // Layout checks are not re-run on client navigation, so every admin page checks itself.
  await requirePlatformAdminPage();
  const { id } = await params;
  const org = await db.restaurantOrganization.findUnique({
    where: { id },
    include: {
      subscription: { include: { plan: true, billingRecords: { orderBy: { createdAt: 'desc' }, take: 24 } } },
      locations: true,
      memberships: { include: { user: { select: { email: true, name: true } } } },
      _count: { select: { products: true, orders: true, feedback: true } },
    },
  });
  if (!org) notFound();
  const [plans, logs, modules] = await Promise.all([
    db.subscriptionPlan.findMany({ orderBy: { sortOrder: 'asc' } }),
    db.auditLog.findMany({ where: { organizationId: org.id }, orderBy: { createdAt: 'desc' }, take: 25 }),
    orgModules(org.id),
  ]);
  const sub = org.subscription;
  return (
    <>
      <PageHeader back={{ href: '/admin', label: 'Tenants' }} title={org.name} meta={<Badge dot tone={org.status === 'ACTIVE' ? 'success' : org.status === 'SUSPENDED' ? 'danger' : 'info'}>{humanize(org.status)}</Badge>} description={`/${org.slug} · ${org.country} · created ${d(org.createdAt)}`} />
      {sub?.pendingPlanId && (
        <div className="mb-6 flex flex-wrap items-center gap-3 rounded-2xl border border-warning/40 bg-warning/10 p-4 text-sm" data-testid="admin-pending-plan">
          <span>The owner requested a change to <strong>{plans.find((p) => p.id === sub.pendingPlanId)?.name ?? sub.pendingPlanId}</strong>. Agree the price with them first.</span>
          <InlineAction action={decidePlanChangeAction} fields={{ organizationId: org.id, apply: 'true' }} label="Apply now" variant="primary" testId="apply-plan" />
          <InlineAction action={decidePlanChangeAction} fields={{ organizationId: org.id, apply: 'false' }} label="Decline" variant="ghost" />
        </div>
      )}
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
          <CardHeader title="Feature modules" description="Ticked = available to this tenant. Plan modules can be switched off; others can be added on. During an active trial every module is available unless switched off here (Platform settings)." />
          <CardBody>
            <ActionForm action={setModulesAction} submitLabel="Save modules">
              <input type="hidden" name="organizationId" value={org.id} />
              <div className="grid gap-2 sm:grid-cols-2">
                {MODULES.map((m) => {
                  const inPlan = !!sub?.plan.features.includes(m);
                  const on = modules.has(m);
                  return <Checkbox key={m} name="modules" value={m} label={MODULE_LABELS[m]} defaultChecked={on} description={org.disabledModules.includes(m) ? 'Switched off by Super Admin' : org.enabledModules.includes(m) ? 'Add-on' : inPlan ? 'Included in plan' : 'Not in plan'} data-testid={`module-${m}`} />;
                })}
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
                  <li key={m.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                    <span className="min-w-0 break-words">{m.user.name} · {m.user.email}</span>
                    <Badge>{humanize(m.role.replace('RESTAURANT_', ''))}</Badge>
                  </li>
                ))}
              </ul>
            </div>
          </CardBody>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader title="Billing records (manual)" description="Record only payments really received (e.g. bank transfer). The owner sees this list as their billing history." />
        <CardBody className="space-y-4">
          {sub ? (
            <ActionForm action={recordBillingAction} submitLabel="Record payment received" resetOnSuccess testId="billing-form" className="grid gap-3 space-y-0 sm:grid-cols-2 sm:items-end xl:grid-cols-5">
              <input type="hidden" name="organizationId" value={org.id} />
              <Field label="Amount (€)" htmlFor="b-amount"><Input id="b-amount" name="amount" inputMode="decimal" placeholder="49,00" /></Field>
              <Field label="Period from" htmlFor="b-from"><Input id="b-from" name="periodStart" type="date" /></Field>
              <Field label="Period to" htmlFor="b-to"><Input id="b-to" name="periodEnd" type="date" /></Field>
              <Field label="Note" htmlFor="b-note" optionalLabel="optional"><Input id="b-note" name="note" maxLength={300} placeholder="Transfer reference" /></Field>
            </ActionForm>
          ) : (
            <p className="text-sm text-muted">No subscription yet.</p>
          )}
          {sub && sub.billingRecords.length > 0 && (
            <ul className="divide-y divide-line text-sm">
              {sub.billingRecords.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-3 py-2" data-testid="billing-record">
                  <span className="font-medium tabular-nums">{formatCents(r.amountCents)}</span>
                  <span className="text-muted">{d(r.periodStart)} – {d(r.periodEnd)}</span>
                  <Badge tone={r.status === 'VOIDED' ? 'danger' : 'success'}>{humanize(r.status)}</Badge>
                  {r.note && <span className="text-xs text-muted">{r.note}</span>}
                  {r.status !== 'VOIDED' && <span className="ms-auto"><InlineAction action={voidBillingAction} fields={{ recordId: r.id, reason: 'Recorded by mistake' }} label="Void" variant="ghost" confirm="Void this billing record (recorded by mistake)?" /></span>}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
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
