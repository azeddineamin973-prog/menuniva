import Link from 'next/link';
import { Badge, ButtonLink, Card, CardHeader, EmptyState, Icon, PageHeader, Stat } from '@/components/ui';
import { Table, TableWrap, TD, TH, THead, TR } from '@/components/ui/table';
import { cn } from '@/lib/cn';
import { formatCents } from '@/lib/money';
import { listTenants, platformMetrics } from '@/server/services/admin';
import { requirePlatformAdminPage } from '@/server/tenant';

export const dynamic = 'force-dynamic';

const STATUS_TONE = { ONBOARDING: 'info', ACTIVE: 'success', SUSPENDED: 'danger', ARCHIVED: 'neutral' } as const;
const STATUS_LABEL = { ONBOARDING: 'Onboarding', ACTIVE: 'Active', SUSPENDED: 'Suspended', ARCHIVED: 'Archived' } as const;
const FILTERS = ['ALL', 'ACTIVE', 'ONBOARDING', 'SUSPENDED', 'ARCHIVED'] as const;
type Filter = (typeof FILTERS)[number];

const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export default async function AdminHome({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  // Layout checks are not re-run on client navigation, so every admin page checks itself.
  await requirePlatformAdminPage();
  const sp = await searchParams;
  const [tenants, metrics] = await Promise.all([listTenants(), platformMetrics()]);
  const q = (sp.q ?? '').trim().slice(0, 100);
  const status: Filter = FILTERS.includes(sp.status as Filter) ? (sp.status as Filter) : 'ALL';
  const needle = fold(q);
  const shown = tenants.filter((t) => (status === 'ALL' || t.status === status) && (!needle || fold(`${t.name} ${t.slug}`).includes(needle)));
  const count = (f: Filter) => (f === 'ALL' ? tenants.length : tenants.filter((t) => t.status === f).length);
  const href = (f: Filter) => {
    const p = new URLSearchParams();
    if (q) p.set('q', q);
    if (f !== 'ALL') p.set('status', f);
    const s = p.toString();
    return s ? `/admin?${s}` : '/admin';
  };

  return (
    <>
      <PageHeader
        title="Restaurants"
        description="All tenants on the platform. Metrics are aggregate counts; private guest feedback is never shown here."
        actions={<ButtonLink href="/admin/tenants/new" icon="plus">Create tenant</ButtonLink>}
      />

      <section aria-label="Tenants" className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Stat label="Real tenants" value={metrics.tenants} icon="building" />
        <Stat label="Active" value={metrics.active} icon="checkCircle" tone="success" />
        <Stat label="Trialing" value={metrics.trialing} icon="clock" />
        <Stat label="Suspended" value={metrics.suspended} icon="lock" tone={metrics.suspended > 0 ? 'danger' : undefined} />
        <Stat label="New tenants (30 days)" value={metrics.newTenants30} icon="plus" />
        <Stat label="Trials ending in 7 days" value={metrics.trialsEndingSoon} icon="calendar" tone={metrics.trialsEndingSoon > 0 ? 'warning' : undefined} />
      </section>
      <section aria-label="Business and health" className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Stat label="Orders (30 days)" value={metrics.orders30} hint="Excludes demo tenants" icon="orders" />
        <Stat label="Recorded billing (30 days)" value={formatCents(metrics.billedCents30)} hint="Manual records of payments received" icon="card" />
        <Stat label="Past due" value={metrics.pastDue} icon="alert" tone={metrics.pastDue > 0 ? 'warning' : undefined} />
        <Stat label="Open support issues" value={metrics.openTickets} icon="help" tone={metrics.openTickets > 0 ? 'info' : undefined} href="/admin/support" />
        <Stat label="Errors (7 days)" value={metrics.errors7} icon="activity" tone={metrics.errors7 > 0 ? 'danger' : undefined} href="/admin/health" />
        <Stat label="Tenants by plan" value={<span className="text-sm font-normal">{metrics.tenantsByPlan.map((p) => `${p.plan}: ${p.count}`).join(' · ') || '—'}</span>} icon="layers" />
      </section>

      {tenants.length === 0 ? (
        <EmptyState icon="building" title="No restaurants yet" description="Create the first tenant or let an owner register." action={<ButtonLink href="/admin/tenants/new" icon="plus">Create tenant</ButtonLink>} />
      ) : (
        <Card className="overflow-hidden">
          <CardHeader title="Tenants" icon="building" description={shown.length === tenants.length ? `${tenants.length} restaurants` : `${shown.length} of ${tenants.length} restaurants`} />
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3 sm:px-5">
            <form action="/admin" className="relative min-w-0 flex-1 basis-56" role="search">
              {status !== 'ALL' && <input type="hidden" name="status" value={status} />}
              <label htmlFor="tenant-search" className="sr-only">
                Search restaurants
              </label>
              <Icon name="search" className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                id="tenant-search"
                type="search"
                name="q"
                defaultValue={q}
                placeholder="Search by name or slug…"
                className="h-9 w-full rounded-lg border border-line bg-surface ps-9 pe-3 text-sm shadow-xs placeholder:text-muted/70 hover:border-line-strong focus:border-[var(--mn-focus)] focus:ring-3 focus:ring-[var(--mn-focus)]/20 focus:outline-none pointer-coarse:h-11 pointer-coarse:text-base"
              />
            </form>
            <nav aria-label="Filter by status" className="mn-scroll -mx-1 flex gap-1 overflow-x-auto px-1">
              {FILTERS.map((f) => (
                <Link
                  key={f}
                  href={href(f)}
                  aria-current={status === f ? 'true' : undefined}
                  className={cn(
                    'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-[13px] font-medium whitespace-nowrap pointer-coarse:h-10',
                    status === f ? 'border-ink bg-ink text-bg' : 'border-line bg-surface text-ink-2 hover:border-line-strong',
                  )}
                >
                  {f === 'ALL' ? 'All' : STATUS_LABEL[f]}
                  <span className={cn('rounded px-1 text-[11px] tabular-nums', status === f ? 'bg-white/15 dark:bg-black/15' : 'bg-surface-2 text-muted')}>{count(f)}</span>
                </Link>
              ))}
            </nav>
          </div>
          {shown.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-muted">No restaurants match. Try another search or filter.</p>
          ) : (
            <TableWrap>
              <Table data-testid="tenants-table">
                <THead>
                  <tr>
                    <TH>Restaurant</TH>
                    <TH>Status</TH>
                    <TH className="hidden md:table-cell">Plan</TH>
                    <TH className="hidden lg:table-cell">Trial ends</TH>
                    <TH className="hidden text-end sm:table-cell">Locations</TH>
                    <TH className="hidden text-end sm:table-cell">Staff</TH>
                    <TH className="hidden text-end md:table-cell">Products</TH>
                    <TH className="text-end">Orders</TH>
                  </tr>
                </THead>
                <tbody>
                  {shown.map((t) => (
                    <TR key={t.id}>
                      <TD>
                        <Link href={`/admin/tenants/${t.id}`} className="font-medium text-ink hover:underline">
                          {t.name}
                        </Link>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                          /{t.slug} · {t.country} {t.isDemo && <Badge tone="warning">Demo</Badge>}
                        </div>
                        {/* Phones: the hidden columns, summarised. */}
                        <div className="mt-0.5 text-xs text-muted md:hidden">{t.subscription ? `${t.subscription.plan.name} · ${t.subscription.status}` : 'No plan'}</div>
                      </TD>
                      <TD>
                        <Badge tone={STATUS_TONE[t.status]} dot>
                          {STATUS_LABEL[t.status]}
                        </Badge>
                      </TD>
                      <TD className="hidden md:table-cell">{t.subscription ? `${t.subscription.plan.name} · ${t.subscription.status}` : '—'}</TD>
                      <TD className="hidden tabular-nums lg:table-cell">{t.subscription?.trialEndsAt ? t.subscription.trialEndsAt.toISOString().slice(0, 10) : '—'}</TD>
                      <TD className="hidden text-end tabular-nums sm:table-cell">{t._count.locations}</TD>
                      <TD className="hidden text-end tabular-nums sm:table-cell">{t._count.memberships}</TD>
                      <TD className="hidden text-end tabular-nums md:table-cell">{t._count.products}</TD>
                      <TD className="text-end tabular-nums">{t._count.orders}</TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          )}
        </Card>
      )}
    </>
  );
}
