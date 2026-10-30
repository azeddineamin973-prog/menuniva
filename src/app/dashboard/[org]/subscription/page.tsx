import { ActionForm } from '@/components/forms/action-form';
import { InlineAction } from '@/components/forms/inline-action';
import { Alert, Badge, Card, CardBody, CardHeader, EmptyState, Field, Input, PageHeader, Select, Stat } from '@/components/ui';
import { cancelPlanChangeAction, planChangeAction } from '../support/actions';
import { getMessages } from '@/i18n';
import { MODULE_LABELS, MODULES } from '@/lib/modules';
import { formatCents } from '@/lib/money';
import { db } from '@/server/db';
import { orgModules } from '@/server/modules';
import { LIMIT_KEYS, LIMIT_LABELS, planLimits, planUsage } from '@/server/services/limits';
import { getPlatformConfig } from '@/server/services/platform-config';
import { requireTenantPage } from '@/server/tenant';

const fmtDate = (d: Date | null | undefined) => (d ? d.toLocaleDateString('pt-PT', { day: 'numeric', month: 'long', year: 'numeric' }) : '—');
const TONE: Record<string, 'success' | 'info' | 'warning' | 'danger' | 'neutral'> = { ACTIVE: 'success', TRIALING: 'info', PAST_DUE: 'warning', SUSPENDED: 'danger', CANCELLED: 'neutral' };

export default async function SubscriptionPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await requireTenantPage(org, 'billing.view');
  const m = getMessages(ctx.user.preferredLanguage);
  const [sub, limits, usage, modules, config, plans] = await Promise.all([
    db.subscription.findUnique({ where: { organizationId: ctx.org.id }, include: { plan: true, billingRecords: { orderBy: { periodStart: 'desc' } } } }),
    planLimits(ctx.org.id),
    planUsage(ctx.org.id),
    orgModules(ctx.org.id),
    getPlatformConfig(),
    db.subscriptionPlan.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } }),
  ]);
  if (!sub) return <EmptyState title="No subscription yet" description="Contact MenuNiva support to set up your plan." />;
  const now = new Date();
  const trialDays = sub.status === 'TRIALING' && sub.trialEndsAt ? Math.ceil((sub.trialEndsAt.getTime() - now.getTime()) / 86400_000) : null;
  return (
    <>
      <PageHeader title={m.nav.subscription} description="Billing is handled manually by MenuNiva: no card is stored and nothing is charged automatically." />
      {sub.status === 'PAST_DUE' && <div className="mb-4"><Alert tone="warning">A payment is overdue. Please contact MenuNiva support{config.supportEmail ? ` (${config.supportEmail})` : ''}.</Alert></div>}
      {trialDays !== null && trialDays <= 0 && <div className="mb-4"><Alert tone="warning">Your trial has ended. Only your plan's features remain available.</Alert></div>}
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Stat label="Plan" value={<span data-testid="sub-plan">{sub.plan.name}</span>} hint={sub.plan.monthlyPriceCents !== null ? `${formatCents(sub.plan.monthlyPriceCents)} / month` : 'Price agreed individually'} />
        <Stat label="Status" value={<Badge tone={TONE[sub.status]} data-testid="sub-status">{sub.status.toLowerCase().replace('_', ' ')}</Badge>} hint={sub.billingPeriod === 'YEARLY' ? 'Billed yearly' : 'Billed monthly'} />
        <Stat
          label={sub.status === 'TRIALING' ? 'Trial ends' : 'Current period ends'}
          value={fmtDate(sub.status === 'TRIALING' ? sub.trialEndsAt : sub.currentPeriodEnd)}
          hint={trialDays !== null && trialDays > 0 ? `${trialDays} day${trialDays === 1 ? '' : 's'} left` : undefined}
        />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Plan limits" description="Your current usage, counted live." />
          <CardBody className="space-y-3">
            {LIMIT_KEYS.map((k) => {
              const limit = limits[k];
              const used = usage[k];
              const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
              return (
                <div key={k} data-testid={`limit-${k}`}>
                  <div className="flex justify-between text-sm"><span>{LIMIT_LABELS[k]}</span><span className="tabular-nums">{used}{limit !== undefined ? ` / ${limit}` : ''}</span></div>
                  {limit !== undefined && <div className="mt-1 h-1.5 rounded bg-surface-2"><div className={pct >= 90 ? 'h-1.5 rounded bg-warning' : 'h-1.5 rounded bg-lime'} style={{ width: `${pct}%` }} /></div>}
                </div>
              );
            })}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Features" description={sub.status === 'TRIALING' && config.trialIncludesAllModules && trialDays !== null && trialDays > 0 ? 'During the trial every feature is available.' : 'Included in your plan or added for you.'} />
          <CardBody>
            <ul className="grid gap-1.5 text-sm sm:grid-cols-2">
              {MODULES.map((k) => (
                <li key={k} className="flex items-center gap-2" data-testid={`feature-${k}`} data-on={modules.has(k)}>
                  <span aria-hidden className={modules.has(k) ? 'text-success' : 'text-muted'}>{modules.has(k) ? '✓' : '—'}</span>
                  <span className={modules.has(k) ? '' : 'text-muted'}>{MODULE_LABELS[k]}</span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      </div>
      <Card className="mt-6">
        <CardHeader title="Change plan" description="Your request goes to MenuNiva. Nothing changes until it is confirmed; you are told the price before any change." />
        <CardBody>
          {sub.pendingPlanId ? (
            <div className="flex flex-wrap items-center gap-3 text-sm" data-testid="pending-plan">
              <span>Requested: <strong>{plans.find((p) => p.id === sub.pendingPlanId)?.name ?? '—'}</strong> (waiting for MenuNiva)</span>
              <InlineAction action={cancelPlanChangeAction} fields={{ org: ctx.org.slug }} label="Cancel request" variant="ghost" />
            </div>
          ) : (
            <ActionForm action={planChangeAction} submitLabel="Request plan change" successText="Request sent" testId="plan-change-form" className="grid gap-3 space-y-0 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
              <input type="hidden" name="org" value={ctx.org.slug} />
              <Field label="New plan" htmlFor="pc-plan">
                <Select id="pc-plan" name="planId">
                  {plans.filter((p) => p.id !== sub.planId).map((p) => <option key={p.id} value={p.id}>{p.name}{p.monthlyPriceCents !== null ? ` · ${formatCents(p.monthlyPriceCents)}/month` : ''}</option>)}
                </Select>
              </Field>
              <Field label="Message" htmlFor="pc-note" optionalLabel="optional"><Input id="pc-note" name="note" maxLength={500} /></Field>
            </ActionForm>
          )}
        </CardBody>
      </Card>
      <Card className="mt-6">
        <CardHeader title="Billing history" description="Only payments MenuNiva actually recorded. These are not legal invoices." />
        {sub.billingRecords.length === 0 ? (
          <CardBody><p className="text-sm text-muted" data-testid="billing-empty">No payments recorded yet.</p></CardBody>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {sub.billingRecords.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3" data-testid="billing-row">
                <span className="font-medium tabular-nums">{formatCents(r.amountCents)}</span>
                <span className="text-muted">{fmtDate(r.periodStart)} – {fmtDate(r.periodEnd)}</span>
                {r.status === 'VOIDED' && <Badge tone="danger">voided</Badge>}
                {r.note && r.status !== 'VOIDED' && <span className="text-xs text-muted">{r.note}</span>}
              </li>
            ))}
          </ul>
        )}
      </Card>
      {config.supportEmail && <p className="mt-6 text-sm text-muted">To change plan, contact <a className="underline" href={`mailto:${config.supportEmail}`}>{config.supportEmail}</a>.</p>}
    </>
  );
}
