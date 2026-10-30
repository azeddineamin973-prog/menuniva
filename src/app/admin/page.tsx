import Link from 'next/link';
import { Badge, ButtonLink, Card, EmptyState, PageHeader, Stat } from '@/components/ui';
import { listTenants, platformMetrics } from '@/server/services/admin';

export const dynamic = 'force-dynamic';

const STATUS_TONE = { ONBOARDING: 'info', ACTIVE: 'success', SUSPENDED: 'danger', ARCHIVED: 'neutral' } as const;

export default async function AdminHome() {
  const [tenants, metrics] = await Promise.all([listTenants(), platformMetrics()]);
  return (
    <>
      <PageHeader title="Restaurants" description="All tenants on the platform. Metrics are aggregate counts; private guest feedback is never shown here." actions={<ButtonLink href="/admin/tenants/new">Create tenant</ButtonLink>} />
      <div className="mb-6 grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Real tenants" value={metrics.tenants} />
        <Stat label="Active" value={metrics.active} />
        <Stat label="Trialing" value={metrics.trialing} />
        <Stat label="Suspended" value={metrics.suspended} />
        <Stat label="Orders (30 days)" value={metrics.orders30} hint="Excludes demo tenants" />
        <Stat label="Errors (7 days)" value={metrics.errors7} />
      </div>
      {tenants.length === 0 ? (
        <EmptyState title="No restaurants yet" description="Create the first tenant or let an owner register." action={<ButtonLink href="/admin/tenants/new">Create tenant</ButtonLink>} />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="tenants-table">
            <thead className="border-b border-line text-start text-xs text-muted uppercase">
              <tr>
                <th className="px-4 py-3 text-start">Restaurant</th>
                <th className="px-4 py-3 text-start">Status</th>
                <th className="px-4 py-3 text-start">Plan</th>
                <th className="px-4 py-3 text-start">Trial ends</th>
                <th className="px-4 py-3 text-end">Locations</th>
                <th className="px-4 py-3 text-end">Staff</th>
                <th className="px-4 py-3 text-end">Products</th>
                <th className="px-4 py-3 text-end">Orders</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((t) => (
                <tr key={t.id} className="border-b border-line last:border-0 hover:bg-surface-2">
                  <td className="px-4 py-3">
                    <Link href={`/admin/tenants/${t.id}`} className="font-medium hover:underline">
                      {t.name}
                    </Link>
                    <div className="text-xs text-muted">
                      /{t.slug} · {t.country} {t.isDemo && <Badge tone="warning">Demo</Badge>}
                    </div>
                  </td>
                  <td className="px-4 py-3"><Badge tone={STATUS_TONE[t.status]}>{t.status}</Badge></td>
                  <td className="px-4 py-3">{t.subscription ? `${t.subscription.plan.name} · ${t.subscription.status}` : '—'}</td>
                  <td className="px-4 py-3">{t.subscription?.trialEndsAt ? t.subscription.trialEndsAt.toISOString().slice(0, 10) : '—'}</td>
                  <td className="px-4 py-3 text-end tabular-nums">{t._count.locations}</td>
                  <td className="px-4 py-3 text-end tabular-nums">{t._count.memberships}</td>
                  <td className="px-4 py-3 text-end tabular-nums">{t._count.products}</td>
                  <td className="px-4 py-3 text-end tabular-nums">{t._count.orders}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
