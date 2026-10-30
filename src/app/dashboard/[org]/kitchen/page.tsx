import Link from 'next/link';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { db } from '@/server/db';
import { requireModulePage } from '@/server/modules';
import { requireTenantPage } from '@/server/tenant';
import { getMessages } from '@/i18n';

export default async function KitchenChooser({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await requireTenantPage(org, 'kds.view');
  await requireModulePage(ctx, 'kds');
  const stations = await db.kitchenStation.findMany({
    where: { organizationId: ctx.org.id, isActive: true, ...(ctx.locationIds.length ? { locationId: { in: ctx.locationIds } } : {}) },
    orderBy: { sortOrder: 'asc' },
    include: { _count: { select: { tickets: { where: { status: { in: ['PENDING', 'PREPARING'] } } } } } },
  });
  const m = getMessages(ctx.user.preferredLanguage);
  return (
    <>
      <PageHeader title={m.nav.kitchen} />
      {stations.length === 0 ? (
        <EmptyState title={m.staff.noStations} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {stations.map((s) => (
            <Link key={s.id} href={`/dashboard/${ctx.org.slug}/kitchen/${s.id}`} data-testid="station-link">
              <Card className="p-6 transition-colors hover:bg-surface-2">
                <p className="text-lg font-semibold">{s.name}</p>
                <p className="text-sm text-muted">{m.staff.openTickets.replace('{n}', String(s._count.tickets))}</p>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
