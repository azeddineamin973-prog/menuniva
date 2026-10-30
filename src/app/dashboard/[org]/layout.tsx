import Link from 'next/link';
import { logoutAction } from '@/app/(auth)/actions';
import { Sidebar, type SidebarLink } from '@/components/dashboard/sidebar';
import { ThemeToggle } from '@/components/dashboard/theme-toggle';
import { Badge } from '@/components/ui';
import { dirOf, getMessages, LANGUAGE_TAG } from '@/i18n';
import { NAV_ITEMS } from '@/lib/nav';
import { db } from '@/server/db';
import { listUserOrganizations } from '@/server/services/organizations';
import { accessibleLocations, requireTenantPage } from '@/server/tenant';
import { currentLocation } from '@/server/current-location';
import { orgModules } from '@/server/modules';
import { LocationSwitcher } from '@/components/dashboard/location-switcher';

export default async function DashboardLayout({ children, params }: { children: React.ReactNode; params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await requireTenantPage(org);
  const m = getMessages(ctx.user.preferredLanguage);
  const base = `/dashboard/${ctx.org.slug}`;

  const [locations, current, modules] = await Promise.all([accessibleLocations(ctx), currentLocation(ctx), orgModules(ctx.org.id)]);
  const [newOrders, openTasks, lowRatings, orgs] = await Promise.all([
    ctx.can('orders.view')
      ? db.order.count({ where: { organizationId: ctx.org.id, status: 'NEW', acknowledgedAt: null, ...(ctx.locationIds.length ? { locationId: { in: ctx.locationIds } } : {}) } })
      : 0,
    ctx.can('tasks.manage')
      ? db.staffTask.count({ where: { organizationId: ctx.org.id, status: 'OPEN', ...(ctx.locationIds.length ? { locationId: { in: ctx.locationIds } } : {}) } })
      : 0,
    ctx.can('reviews.view')
      ? db.notification.count({ where: { organizationId: ctx.org.id, type: 'LOW_RATING', readAt: null, ...(ctx.locationIds.length ? { locationId: { in: ctx.locationIds } } : {}) } })
      : 0,
    listUserOrganizations(ctx.userId),
  ]);

  const links: SidebarLink[] = NAV_ITEMS.filter((i) => ctx.can(i.permission) && (!i.module || modules.has(i.module))).map((i) => ({
    href: `${base}${i.path}`,
    label: m.nav[i.key],
    group: i.group,
    badge: i.key === 'liveOrders' ? newOrders : i.key === 'tasks' ? openTasks : i.key === 'reviews' ? lowRatings : undefined,
  }));

  const lang = ctx.user.preferredLanguage;
  return (
    <div lang={LANGUAGE_TAG[lang]} dir={dirOf(lang)} className="min-h-dvh lg:flex">
      <Sidebar
        links={links}
        groupLabels={{ operate: m.staff.groupOperate, menu: m.staff.groupMenu, grow: m.staff.groupGrow, manage: m.staff.groupManage }}
        orgName={ctx.org.name}
        orgSwitcher={
          <>
            {locations.length > 1 && current && <LocationSwitcher orgSlug={ctx.org.slug} current={current.id} locations={locations.map((l) => ({ id: l.id, name: l.name }))} />}
            {orgs.length > 1 && (
              <Link href="/dashboard?choose=1" className="mt-1 inline-block text-xs text-muted underline-offset-2 hover:underline">
                Switch restaurant
              </Link>
            )}
          </>
        }
        footer={
          <div className="space-y-1">
            <p className="truncate px-3 text-xs text-muted">
              <Link href="/account" className="underline-offset-2 hover:underline" data-testid="my-account-link">{ctx.user.name}</Link> · {ctx.role.replace('RESTAURANT_', '').replace('_', ' ').toLowerCase()}
            </p>
            <ThemeToggle />
            <form action={logoutAction}>
              <button className="w-full rounded-xl px-3 py-2 text-start text-sm text-ink/80 hover:bg-surface-2">{m.auth.signOut}</button>
            </form>
          </div>
        }
      />
      <div className="min-w-0 flex-1">
        {ctx.org.isDemo && (
          <div className="bg-warning/15 px-4 py-1.5 text-center text-xs font-medium text-warning">
            DEMO restaurant — all data here is fictitious and for testing only.
          </div>
        )}
        {ctx.org.status === 'ONBOARDING' && ctx.can('settings.manage') && (
          <div className="flex items-center justify-center gap-2 border-b border-line bg-surface px-4 py-2 text-sm">
            <Badge tone="lime">Setup</Badge>
            <span className="text-muted">Your restaurant is not published yet.</span>
            <Link href={`${base}/setup`} className="font-medium underline-offset-4 hover:underline">
              Continue setup →
            </Link>
          </div>
        )}
        <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
