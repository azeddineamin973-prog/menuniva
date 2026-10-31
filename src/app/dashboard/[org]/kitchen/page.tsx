import Link from 'next/link';
import { ButtonLink, EmptyState, Icon, PageHeader } from '@/components/ui';
import { db } from '@/server/db';
import { requireModulePage } from '@/server/module-page';
import { requireTenantPage } from '@/server/tenant';
import { getMessages } from '@/i18n';
import { cn } from '@/lib/cn';

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
  const canManage = ctx.can('stations.manage');
  return (
    <>
      <PageHeader title={m.nav.kitchen} description="Choose the screen for this device. Each station only shows the dishes sent to it." />
      {stations.length === 0 ? (
        <EmptyState icon="station" title={m.staff.noStations} action={canManage && <ButtonLink href={`/dashboard/${ctx.org.slug}/stations`} icon="plus">Create stations</ButtonLink>} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {stations.map((s) => {
            const open = s._count.tickets;
            return (
              <Link
                key={s.id}
                href={`/dashboard/${ctx.org.slug}/kitchen/${s.id}`}
                data-testid="station-link"
                className="group flex items-center gap-4 rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-xs transition-[border-color,box-shadow] hover:border-line-strong hover:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--mn-focus)] sm:p-5"
              >
                <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-graphite text-lime">
                  <Icon name="kitchen" className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-base font-semibold text-ink">{s.name}</span>
                  <span className={cn('mt-0.5 inline-flex items-center gap-1.5 text-sm', open > 0 ? 'font-medium text-warning' : 'text-muted')}>
                    <span className={cn('size-1.5 rounded-full', open > 0 ? 'bg-warning' : 'bg-line-strong')} aria-hidden />
                    {m.staff.openTickets.replace('{n}', String(open))}
                  </span>
                </span>
                <Icon name="chevronRight" className="text-muted transition-transform group-hover:translate-x-0.5 rtl:rotate-180 rtl:group-hover:-translate-x-0.5" />
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
