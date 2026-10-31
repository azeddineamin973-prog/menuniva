import { redirect } from 'next/navigation';
import { SetupChecklist } from '@/components/dashboard/setup-checklist';
import { ButtonLink, Card, CardBody, CardHeader, PageHeader, Stat, statGrid } from '@/components/ui';
import { getMessages } from '@/i18n';
import { formatCents } from '@/lib/money';
import { db } from '@/server/db';
import { getSetupProgress } from '@/server/services/setup-progress';
import { requireTenantPage } from '@/server/tenant';
import { startOfDayInZone } from '@/lib/time';

export default async function OverviewPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await requireTenantPage(org);
  const base = `/dashboard/${ctx.org.slug}`;

  // Staff without the overview permission go straight to their workspace.
  if (!ctx.can('overview.view')) {
    if (ctx.can('kds.view')) redirect(`${base}/kitchen`);
    if (ctx.can('delivery.driver')) redirect(`${base}/driver`);
    redirect(`${base}/forbidden`);
  }

  const m = getMessages(ctx.user.preferredLanguage);
  const location = await db.restaurantLocation.findFirst({ where: { organizationId: ctx.org.id }, orderBy: { createdAt: 'asc' } });
  const since = startOfDayInZone(new Date(), location?.timeZone ?? 'Europe/Lisbon');
  const scope = { organizationId: ctx.org.id, ...(ctx.locationIds.length ? { locationId: { in: ctx.locationIds } } : {}) };

  const [setup, todayOrders, activeOrders, openTasks, todayValue] = await Promise.all([
    ctx.can('settings.manage') ? getSetupProgress(ctx.org.id) : null,
    db.order.count({ where: { ...scope, createdAt: { gte: since } } }),
    db.order.count({ where: { ...scope, status: { in: ['NEW', 'ACCEPTED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY'] } } }),
    db.staffTask.count({ where: { ...scope, status: 'OPEN' } }),
    db.order.aggregate({ where: { ...scope, createdAt: { gte: since }, status: { not: 'CANCELLED' } }, _sum: { totalCents: true, paidCents: true } }),
  ]);

  return (
    <>
      <PageHeader
        title={m.nav.overview}
        description={`${ctx.org.name} — today at a glance. All figures come from real orders in this restaurant.`}
        actions={ctx.can('orders.view') && <ButtonLink href={`${base}/orders`}>{m.nav.liveOrders}</ButtonLink>}
      />
      {/* Each figure opens the screen where it can be acted on. */}
      <div className={statGrid(4)}>
        <Stat label="Orders today" value={todayOrders} href={ctx.can('analytics.view') ? `${base}/analytics` : undefined} />
        <Stat label="Active orders" value={activeOrders} href={ctx.can('orders.view') ? `${base}/orders` : undefined} />
        <Stat label="Open table requests" value={openTasks} href={ctx.can('tasks.manage') ? `${base}/tasks` : undefined} />
        <Stat
          label="Order value today"
          value={formatCents(todayValue._sum.totalCents ?? 0)}
          hint={`Payments recorded: ${formatCents(todayValue._sum.paidCents ?? 0)} — order value is not the same as money collected.`}
          href={ctx.can('analytics.view') ? `${base}/analytics` : undefined}
        />
      </div>
      {setup && setup.completed < setup.steps.length && (
        <div className="mt-6">
          <SetupChecklist steps={setup.steps} base={base} onlyRemaining />
        </div>
      )}
      {todayOrders === 0 && (
        <Card className="mt-6">
          <CardHeader title="No orders yet today" />
          <CardBody className="text-sm text-muted">
            When guests order from a table QR code, takeaway or delivery, orders appear here and in Live Orders.
          </CardBody>
        </Card>
      )}
    </>
  );
}
