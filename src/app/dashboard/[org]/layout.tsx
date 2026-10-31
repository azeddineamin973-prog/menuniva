import Link from 'next/link';
import { cookies } from 'next/headers';
import { AppShell, type ShellAlert, type SidebarLink } from '@/components/dashboard/sidebar';
import { Badge, Icon } from '@/components/ui';
import { ToastProvider } from '@/components/ui/toast';
import { dirOf, getMessages, LANGUAGE_TAG } from '@/i18n';
import { NAV_ITEMS } from '@/lib/nav';
import { db } from '@/server/db';
import { listUserOrganizations } from '@/server/services/organizations';
import { getSetupProgress } from '@/server/services/setup-progress';
import { accessibleLocations, requireTenantPage } from '@/server/tenant';
import { currentLocation } from '@/server/current-location';
import { orgModules } from '@/server/modules';

export default async function DashboardLayout({ children, params }: { children: React.ReactNode; params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await requireTenantPage(org);
  const m = getMessages(ctx.user.preferredLanguage);
  const base = `/dashboard/${ctx.org.slug}`;
  const jar = await cookies();

  const [locations, current, modules] = await Promise.all([accessibleLocations(ctx), currentLocation(ctx), orgModules(ctx.org.id)]);
  const scoped = ctx.locationIds.length ? { locationId: { in: ctx.locationIds } } : {};
  const [newOrders, openTasks, lowRatings, orgs, setup] = await Promise.all([
    ctx.can('orders.view') ? db.order.count({ where: { organizationId: ctx.org.id, status: 'NEW', acknowledgedAt: null, ...scoped } }) : 0,
    ctx.can('tasks.manage') ? db.staffTask.count({ where: { organizationId: ctx.org.id, status: 'OPEN', ...scoped } }) : 0,
    ctx.can('reviews.view') ? db.notification.count({ where: { organizationId: ctx.org.id, type: 'LOW_RATING', readAt: null, ...scoped } }) : 0,
    listUserOrganizations(ctx.userId),
    ctx.can('settings.manage') ? getSetupProgress(ctx.org.id, current?.id) : null,
  ]);

  const visible = NAV_ITEMS.filter((i) => ctx.can(i.permission) && (!i.module || modules.has(i.module)));
  const toLink = (i: (typeof NAV_ITEMS)[number]): SidebarLink => ({
    href: `${base}${i.path}`,
    key: i.key,
    icon: i.icon,
    label: m.nav[i.key],
    group: i.group,
    badge: i.key === 'liveOrders' ? newOrders : i.key === 'tasks' ? openTasks : i.key === 'reviews' ? lowRatings : undefined,
  });
  const setupDone = !setup || setup.completed === setup.steps.length;
  // The setup wizard shows as a progress card while unfinished; afterwards it is reached from the account menu.
  const links = visible.filter((i) => !i.placement || i.placement === 'sidebar').map(toLink);
  const accountLinks = visible.filter((i) => i.placement === 'account' || (i.placement === 'setup' && setupDone)).map(toLink);
  const alerts: ShellAlert[] = [
    { key: 'orders', label: `New order${newOrders === 1 ? '' : 's'} waiting`, count: newOrders, href: `${base}/orders`, icon: 'orders' },
    { key: 'tasks', label: 'Table requests', count: openTasks, href: `${base}/tasks`, icon: 'bell' },
    { key: 'reviews', label: 'Low ratings to follow up', count: lowRatings, href: `${base}/reviews`, icon: 'star' },
  ];

  const lang = ctx.user.preferredLanguage;
  const role = ctx.role.replace('RESTAURANT_', '').replace('_', ' ').toLowerCase();
  const banners = (
    <>
      {ctx.org.isDemo && <div className="bg-warning/15 px-4 py-1.5 text-center text-xs font-medium text-warning">DEMO restaurant — all data here is fictitious and for testing only.</div>}
      {ctx.org.status === 'ONBOARDING' && ctx.can('settings.manage') && (
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-line bg-accent-soft/60 px-4 py-2 text-[13px]">
          <Badge tone="lime">Setup</Badge>
          <span className="text-ink-2">Your restaurant is not published yet.</span>
          <Link href={`${base}/setup`} className="inline-flex min-h-8 items-center font-medium text-ink underline-offset-4 hover:underline">
            Continue setup <Icon name="arrowRight" className="ms-0.5 inline size-3.5 align-[-2px]" />
          </Link>
        </div>
      )}
    </>
  );

  return (
    <div lang={LANGUAGE_TAG[lang]} dir={dirOf(lang)}>
      <a href="#main" className="sr-only z-[60] rounded-lg bg-lime px-4 py-2 text-sm font-semibold text-lime-ink focus:not-sr-only focus:fixed focus:start-3 focus:top-3">
        {m.shell.skipToContent}
      </a>
      <ToastProvider>
        <AppShell
          links={links}
          accountLinks={accountLinks}
          groupLabels={{ operate: m.staff.groupOperate, menu: m.staff.groupMenu, grow: m.staff.groupGrow, manage: m.staff.groupManage }}
          labels={{ more: m.shell.more, openMenu: m.shell.openMenu, closeMenu: m.shell.closeMenu, restaurant: m.shell.restaurant, navigation: m.shell.navigation, quickNav: m.shell.quickNav, switchRestaurant: m.shell.switchRestaurant, short: m.shell.short }}
          org={{ name: ctx.org.name, slug: ctx.org.slug }}
          orgs={orgs.map((o) => ({ slug: o.organization.slug, name: o.organization.name }))}
          locations={locations.map((l) => ({ id: l.id, name: l.name }))}
          currentLocationId={current?.id}
          user={{ name: ctx.user.name, email: ctx.user.email, role }}
          setup={setupDone || !setup ? null : { href: `${base}/setup`, completed: setup.completed, total: setup.steps.length }}
          alerts={alerts}
          initialCollapsed={jar.get('mn_sidebar')?.value === 'collapsed'}
          signOutLabel={m.auth.signOut}
          themeLabels={{ dark: 'Dark mode', light: 'Light mode' }}
          banners={banners}
        >
          {children}
        </AppShell>
      </ToastProvider>
    </div>
  );
}
