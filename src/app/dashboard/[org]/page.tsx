import Link from 'next/link';
import { redirect } from 'next/navigation';
import { SetupChecklist } from '@/components/dashboard/setup-checklist';
import { RestaurantLinkCard } from '@/components/dashboard/restaurant-link-card';
import { getRestaurantLink } from '@/server/services/restaurant-link';
import { Badge, ButtonLink, Card, CardHeader, EmptyState, Icon, PageHeader, Stat, statGrid, type IconName } from '@/components/ui';
import { getMessages } from '@/i18n';
import { LANGUAGE_TAG } from '@/i18n/config';
import { formatCents } from '@/lib/money';
import { db } from '@/server/db';
import { currentLocation } from '@/server/current-location';
import { unroutedDishes } from '@/server/services/publish';
import { getSetupProgress } from '@/server/services/setup-progress';
import { requireTenantPage } from '@/server/tenant';
import { startOfDayInZone } from '@/lib/time';

const STATUS: Record<string, { label: string; tone: 'lime' | 'info' | 'warning' | 'success' | 'neutral' }> = {
  NEW: { label: 'New', tone: 'lime' },
  ACCEPTED: { label: 'Accepted', tone: 'info' },
  PREPARING: { label: 'Preparing', tone: 'warning' },
  READY: { label: 'Ready', tone: 'success' },
  OUT_FOR_DELIVERY: { label: 'Out for delivery', tone: 'info' },
  DELIVERED: { label: 'Delivered', tone: 'success' },
};

/** Restaurant home: today's figures, what is happening now, and what needs a decision. */
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
  const tag = LANGUAGE_TAG[ctx.user.preferredLanguage];
  const location = (await currentLocation(ctx)) ?? (await db.restaurantLocation.findFirst({ where: { organizationId: ctx.org.id }, orderBy: { createdAt: 'asc' } }));
  const timeZone = location?.timeZone ?? 'Europe/Lisbon';
  const since = startOfDayInZone(new Date(), timeZone);
  const scope = { organizationId: ctx.org.id, ...(ctx.locationIds.length ? { locationId: { in: ctx.locationIds } } : {}) };
  const ACTIVE = ['NEW', 'ACCEPTED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY'] as const;
  const canMenu = ctx.can('menu.edit');
  const canPreview = ctx.can('menu.view');

  const [setup, todayOrders, activeOrders, openTasks, todayValue, live, waiting, lowRatings, noPrice, soldOut, unrouted] = await Promise.all([
    ctx.can('settings.manage') ? getSetupProgress(ctx.org.id, location?.id) : null,
    db.order.count({ where: { ...scope, createdAt: { gte: since } } }),
    db.order.count({ where: { ...scope, status: { in: [...ACTIVE] } } }),
    db.staffTask.count({ where: { ...scope, status: 'OPEN' } }),
    db.order.aggregate({ where: { ...scope, createdAt: { gte: since }, status: { not: 'CANCELLED' } }, _sum: { totalCents: true, paidCents: true } }),
    ctx.can('orders.view')
      ? db.order.findMany({ where: { ...scope, status: { in: [...ACTIVE] } }, orderBy: [{ isPriority: 'desc' }, { createdAt: 'asc' }], take: 6, include: { table: { select: { label: true } } } })
      : [],
    ctx.can('orders.view') ? db.order.count({ where: { ...scope, status: 'NEW', acknowledgedAt: null } }) : 0,
    ctx.can('reviews.view') ? db.notification.count({ where: { ...scope, type: 'LOW_RATING', readAt: null } }) : 0,
    canMenu ? db.menuProduct.count({ where: { organizationId: ctx.org.id, status: { not: 'ARCHIVED' }, prices: { none: { channel: 'DINE_IN' } } } }) : 0,
    ctx.can('menu.availability') ? db.menuProduct.count({ where: { organizationId: ctx.org.id, status: 'ACTIVE', soldOut: true } }) : 0,
    canMenu ? unroutedDishes(ctx.org.id).then((u) => u.length) : 0,
  ]);
  // Publish blockers are already listed by the setup checklist; the card only needs them when it is done.
  const link = canPreview && location ? await getRestaurantLink(ctx, location.id, { checks: ctx.can('settings.manage') }) : null;

  const attention: { icon: IconName; text: string; href: string; tone: 'lime' | 'warning' | 'danger' | 'info' }[] = [];
  if (waiting) attention.push({ icon: 'orders', text: `${waiting} new order${waiting === 1 ? '' : 's'} waiting to be accepted`, href: `${base}/orders`, tone: 'lime' });
  if (openTasks && ctx.can('tasks.manage')) attention.push({ icon: 'bell', text: `${openTasks} table request${openTasks === 1 ? '' : 's'} (waiter or bill)`, href: `${base}/tasks`, tone: 'lime' });
  if (lowRatings) attention.push({ icon: 'star', text: `${lowRatings} low rating${lowRatings === 1 ? '' : 's'} to follow up`, href: `${base}/reviews`, tone: 'danger' });
  if (unrouted) attention.push({ icon: 'station', text: `${unrouted} visible dish${unrouted === 1 ? ' is' : 'es are'} not sent to any kitchen screen`, href: `${base}/stations`, tone: 'warning' });
  if (noPrice) attention.push({ icon: 'tag', text: `${noPrice} dish${noPrice === 1 ? ' has' : 'es have'} no dine-in price`, href: `${base}/menu/quick`, tone: 'warning' });
  if (soldOut) attention.push({ icon: 'eyeOff', text: `${soldOut} dish${soldOut === 1 ? ' is' : 'es are'} marked sold out`, href: `${base}/menu/quick`, tone: 'info' });
  if (location && !location.isPublished && ctx.can('settings.manage')) attention.push({ icon: 'globe', text: `${location.name} is not published yet`, href: `${base}/setup/publish`, tone: 'warning' });

  const elapsed = (d: Date) => {
    const min = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
    return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`;
  };
  const today = new Intl.DateTimeFormat(tag, { weekday: 'long', day: 'numeric', month: 'long', timeZone }).format(new Date());

  const shortcuts = (
            <Card>
              <CardHeader icon="sparkles" title="Shortcuts" />
              <div className="grid grid-cols-2 gap-2 p-3">
                {[
                  ctx.can('kds.view') && { href: `${base}/kitchen`, icon: 'kitchen' as IconName, label: m.nav.kitchen },
                  ctx.can('tables.view') && { href: `${base}/tables/print`, icon: 'print' as IconName, label: 'Print QR codes' },
                  canMenu && { href: `${base}/menu/products/new`, icon: 'plus' as IconName, label: 'Add a dish' },
                  ctx.can('menu.availability') && { href: `${base}/menu/quick`, icon: 'tag' as IconName, label: 'Prices & sold out' },
                  ctx.can('payments.record') && { href: `${base}/bills`, icon: 'bill' as IconName, label: m.nav.bills },
                  link?.location.isPublished && { href: link.path, icon: 'external' as IconName, label: 'Guest menu' },
                ]
                  .filter((x): x is { href: string; icon: IconName; label: string } => !!x)
                  .map((s) => (
                    <Link
                      key={s.href}
                      href={s.href}
                      target={s.href.startsWith('/r/') ? '_blank' : undefined}
                      className="flex min-h-10 items-center gap-2 rounded-lg border border-line px-3 py-2 text-[13px] font-medium text-ink-2 transition-colors hover:border-line-strong hover:bg-surface-2 hover:text-ink"
                    >
                      <Icon name={s.icon} className="text-muted" />
                      <span className="truncate">{s.label}</span>
                    </Link>
                  ))}
              </div>
            </Card>
    );

  return (
    <>
      <PageHeader
        title={m.nav.overview}
        description={`${location?.name ?? ctx.org.name} · ${today}`}
        actions={
          <>
            {canPreview && (
              <ButtonLink href={`${base}/preview`} variant="secondary" icon="phone" data-testid="preview-restaurant-button">
                Preview my restaurant
              </ButtonLink>
            )}
            {ctx.can('orders.view') && <ButtonLink href={`${base}/orders`} icon="orders">{m.nav.liveOrders}</ButtonLink>}
          </>
        }
      />

      <div className={statGrid(4)}>
        <Stat icon="orders" label="Orders today" value={todayOrders} href={ctx.can('analytics.view') ? `${base}/analytics` : undefined} />
        <Stat icon="zap" tone={activeOrders ? 'lime' : undefined} label="Active orders" value={activeOrders} href={ctx.can('orders.view') ? `${base}/orders` : undefined} />
        <Stat icon="bell" tone={openTasks ? 'warning' : undefined} label="Open table requests" value={openTasks} href={ctx.can('tasks.manage') ? `${base}/tasks` : undefined} />
        <Stat
          icon="chart"
          label="Order value today"
          value={formatCents(todayValue._sum.totalCents ?? 0)}
          hint={`${formatCents(todayValue._sum.paidCents ?? 0)} collected — order value is not money collected.`}
          href={ctx.can('analytics.view') ? `${base}/analytics` : undefined}
        />
      </div>

      <div className="mt-5 grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-5">
          {ctx.can('orders.view') && (
            <Card>
              <CardHeader icon="zap" title="Happening now" description={activeOrders ? `${activeOrders} active order${activeOrders === 1 ? '' : 's'}` : 'No active orders'} action={<ButtonLink href={`${base}/orders`} variant="ghost" size="sm" iconEnd="arrowRight">Live Orders</ButtonLink>} />
              {live.length === 0 ? (
                <div className="px-5 py-8 text-center text-sm text-muted" data-testid="overview-no-active">
                  {todayOrders === 0 ? 'No orders yet today. When guests order from a table QR code, takeaway or delivery, orders appear here and in Live Orders.' : 'All orders are completed. New ones appear here as they arrive.'}
                </div>
              ) : (
                <ul className="divide-y divide-line" data-testid="overview-live">
                  {live.map((o) => {
                    const st = STATUS[o.status] ?? { label: o.status.toLowerCase(), tone: 'neutral' as const };
                    const where = o.channel === 'TABLE' ? `Table ${o.table?.label ?? '?'}` : o.channel === 'TAKEAWAY' ? `Takeaway${o.customerName ? ` · ${o.customerName}` : ''}` : 'Delivery';
                    return (
                      <li key={o.id}>
                        <Link href={`${base}/orders`} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2/60 sm:px-5">
                          <span className="w-12 shrink-0 text-[15px] font-semibold tabular-nums">#{o.number}</span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-ink">{where}</span>
                            <span className="block text-xs text-muted">{elapsed(o.createdAt)} ago</span>
                          </span>
                          {o.isPriority && <Badge tone="danger">Priority</Badge>}
                          <Badge tone={st.tone} dot>
                            {st.label}
                          </Badge>
                          <span className="hidden w-20 text-end text-sm tabular-nums sm:block">{formatCents(o.totalCents, tag)}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          )}
          {setup && setup.completed < setup.steps.length && <SetupChecklist steps={setup.steps} base={base} onlyRemaining />}
          {link && <RestaurantLinkCard link={link} orgSlug={ctx.org.slug} canPublish={ctx.can('settings.manage')} />}
        </div>

        {/* Phones: what needs a decision comes first, shortcuts last. */}
        <div className="order-first space-y-5 xl:order-none">
          <Card>
            <CardHeader icon="alert" title="Needs attention" />
            {attention.length === 0 ? (
              <div className="flex items-center gap-3 px-5 py-6 text-sm text-muted">
                <span className="flex size-8 items-center justify-center rounded-full bg-success/10 text-success">
                  <Icon name="check" />
                </span>
                All clear — nothing is waiting for you.
              </div>
            ) : (
              <ul className="divide-y divide-line" data-testid="overview-attention">
                {attention.map((a) => (
                  <li key={a.text}>
                    <Link href={a.href} className="group flex items-start gap-3 px-4 py-3 text-sm transition-colors hover:bg-surface-2/60 sm:px-5">
                      <span
                        className={
                          a.tone === 'danger'
                            ? 'mt-px flex size-7 shrink-0 items-center justify-center rounded-lg bg-danger/10 text-danger'
                            : a.tone === 'warning'
                              ? 'mt-px flex size-7 shrink-0 items-center justify-center rounded-lg bg-warning/10 text-warning'
                              : a.tone === 'info'
                                ? 'mt-px flex size-7 shrink-0 items-center justify-center rounded-lg bg-info/10 text-info'
                                : 'mt-px flex size-7 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent'
                        }
                      >
                        <Icon name={a.icon} />
                      </span>
                      <span className="min-w-0 flex-1 pt-0.5 text-ink-2 group-hover:text-ink">{a.text}</span>
                      <Icon name="chevronRight" className="mt-1.5 text-muted rtl:rotate-180" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <div className="hidden xl:block">{shortcuts}</div>
          {!ctx.can('orders.view') && todayOrders === 0 && <EmptyState title="No orders yet today" icon="orders" />}
        </div>
        <div className="xl:hidden">{shortcuts}</div>
      </div>
    </>
  );
}
