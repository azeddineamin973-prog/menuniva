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
    key: i.key,
    label: m.nav[i.key],
    group: i.group,
    badge: i.key === 'liveOrders' ? newOrders : i.key === 'tasks' ? openTasks : i.key === 'reviews' ? lowRatings : undefined,
  }));

  const lang = ctx.user.preferredLanguage;
  const role = ctx.role.replace('RESTAURANT_', '').replace('_', ' ').toLowerCase();
  return (
    <div lang={LANGUAGE_TAG[lang]} dir={dirOf(lang)} className="min-h-dvh lg:flex">
      <a
        href="#main"
        className="sr-only z-[60] rounded-xl bg-lime px-4 py-2 text-sm font-semibold text-graphite focus:not-sr-only focus:fixed focus:start-3 focus:top-3"
      >
        {m.shell.skipToContent}
      </a>
      <Sidebar
        links={links}
        groupLabels={{ operate: m.staff.groupOperate, menu: m.staff.groupMenu, grow: m.staff.groupGrow, manage: m.staff.groupManage }}
        orgName={ctx.org.name}
        labels={{ more: m.shell.more, openMenu: m.shell.openMenu, closeMenu: m.shell.closeMenu, restaurant: m.shell.restaurant, navigation: m.shell.navigation, quickNav: m.shell.quickNav, short: m.shell.short }}
        orgSwitcher={
          <>
            {locations.length > 1 && current && <LocationSwitcher orgSlug={ctx.org.slug} current={current.id} locations={locations.map((l) => ({ id: l.id, name: l.name }))} />}
            {orgs.length > 1 && (
              <Link href="/dashboard?choose=1" className="mt-1 inline-flex min-h-8 items-center text-xs text-muted underline-offset-2 hover:underline">
                {m.shell.switchRestaurant}
              </Link>
            )}
          </>
        }
        footer={
          <div className="flex items-center gap-1">
            <Link href="/account" className="min-w-0 flex-1 rounded-xl px-2.5 py-1.5 hover:bg-surface-2" data-testid="my-account-link" title={ctx.user.email}>
              <span className="block truncate text-sm font-medium text-ink">{ctx.user.name}</span>
              <span className="block truncate text-xs text-muted capitalize">{role}</span>
            </Link>
            <ThemeToggle />
            <form action={logoutAction}>
              <button className="flex size-10 items-center justify-center rounded-xl text-ink/80 hover:bg-surface-2 hover:text-ink" aria-label={m.auth.signOut} title={m.auth.signOut}>
                <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M14 4.5h3.5a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H14M10 16l4-4-4-4M14 12H4" />
                </svg>
              </button>
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
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-line bg-surface px-4 py-2 text-sm">
            <Badge tone="lime">Setup</Badge>
            <span className="text-muted">Your restaurant is not published yet.</span>
            <Link href={`${base}/setup`} className="inline-flex min-h-8 items-center font-medium underline-offset-4 hover:underline">
              Continue setup →
            </Link>
          </div>
        )}
        {/* Bottom padding on phones keeps the last controls clear of the bottom navigation bar. */}
        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-7xl px-4 pt-6 pb-24 outline-none sm:px-6 lg:px-8 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
