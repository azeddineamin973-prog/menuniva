'use client';

import Link, { useLinkStatus } from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { logoutAction } from '@/app/(auth)/actions';
import { LogoMark } from '@/components/brand/logo';
import { Icon, type IconName } from '@/components/ui/icons';
import { Menu, type MenuItem } from '@/components/ui/menu';
import { cn } from '@/lib/cn';
import { SUB_PAGES } from '@/lib/nav';
import { ThemeToggle } from './theme-toggle';

export type SidebarLink = { href: string; label: string; group: string; key: string; icon: IconName; badge?: number };
export type ShellLabels = {
  more: string;
  openMenu: string;
  closeMenu: string;
  restaurant: string;
  navigation: string;
  quickNav: string;
  switchRestaurant: string;
  short: Record<string, string>;
};
export type ShellAlert = { key: string; label: string; count: number; href: string; icon: IconName };
export type ShellProps = {
  links: SidebarLink[];
  accountLinks: SidebarLink[];
  groupLabels: Record<string, string>;
  labels: ShellLabels;
  org: { name: string; slug: string };
  orgs: { slug: string; name: string }[];
  locations: { id: string; name: string }[];
  currentLocationId?: string;
  user: { name: string; email: string; role: string };
  setup: { href: string; completed: number; total: number } | null;
  alerts: ShellAlert[];
  initialCollapsed: boolean;
  signOutLabel: string;
  themeLabels: { dark: string; light: string };
  banners?: React.ReactNode;
  children: React.ReactNode;
};

const GROUP_KEYS = ['operate', 'menu', 'grow', 'manage'];
/**
 * Sections that earn a place in the phone bottom bar, most used first. Each person sees the first
 * four their role can open (a cook gets Kitchen, a driver their deliveries); everything else stays
 * one tap away under "More".
 */
const BOTTOM_PRIORITY = ['liveOrders', 'kitchen', 'myDeliveries', 'tables', 'menu', 'tasks', 'reservations', 'bills', 'overview'];

function initials(name: string) {
  return (
    name
      .split(/[\s—–-]+/)
      .filter((w) => /[\p{L}\p{N}]/u.test(w))
      .slice(0, 2)
      .map((w) => w[0])
      .join('')
      .toUpperCase() || '·'
  );
}

/**
 * Dashboard frame. Desktop: collapsible sidebar (full or icons only, remembered per browser)
 * and a top bar with breadcrumbs, search, notifications and theme. Phones: top bar, a drawer
 * with the full navigation and a bottom bar with the four most used sections for the role.
 */
export function AppShell(props: ShellProps) {
  const { links, labels, org, alerts, initialCollapsed, banners, children } = props;
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [searchOpen, setSearchOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  useEffect(() => setOpen(false), [pathname]);

  // Drawer behaves like a dialog: Escape closes it, focus moves in and back, the page stays put.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const drawer = drawerRef.current;
    (drawer?.querySelector<HTMLElement>('a[aria-current=page]') ?? drawer?.querySelector<HTMLElement>('a[href]'))?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      openerRef.current?.focus();
    };
  }, [open]);

  // ⌘K / Ctrl+K opens the search palette from anywhere in the dashboard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    document.cookie = `mn_sidebar=${next ? 'collapsed' : 'expanded'}; path=/; max-age=31536000; samesite=lax`;
  };
  const home = links[0]?.href ?? `/dashboard/${org.slug}`;
  const isActive = (href: string) => (href === home ? pathname === href : pathname === href || pathname.startsWith(`${href}/`));
  const bottom = BOTTOM_PRIORITY.map((k) => links.find((l) => l.key === k)).filter((l): l is SidebarLink => !!l).slice(0, 4);
  // "More" is highlighted when the current page is not one of the bottom-bar sections.
  const moreActive = !bottom.some((l) => isActive(l.href));
  const openDrawer = (e: React.MouseEvent<HTMLElement>) => {
    openerRef.current = e.currentTarget;
    setOpen((v) => !v);
  };
  const alertTotal = alerts.reduce((n, a) => n + a.count, 0);

  return (
    <div className="min-h-dvh lg:flex">
      <aside
        className={cn('sticky top-0 hidden h-dvh shrink-0 border-e border-line bg-surface transition-[width] duration-200 lg:block', collapsed ? 'w-16' : 'w-60')}
        data-collapsed={collapsed}
        data-testid="sidebar"
      >
        <SidebarContent {...props} collapsed={collapsed} isActive={isActive} onToggleCollapsed={toggleCollapsed} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar {...props} isActive={isActive} alertTotal={alertTotal} onOpenSearch={() => setSearchOpen(true)} onOpenMenu={openDrawer} drawerOpen={open} />
        {banners}
        {/* Bottom padding on phones keeps the last controls clear of the bottom navigation bar. */}
        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[90rem] flex-1 px-4 pt-5 pb-24 outline-none sm:px-6 lg:px-8 lg:pt-7 lg:pb-10">
          {children}
        </main>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" id="mobile-nav" role="dialog" aria-modal="true" aria-label={labels.openMenu}>
          <button type="button" aria-hidden tabIndex={-1} title={labels.closeMenu} className="animate-fade-in absolute inset-0 bg-black/45" onClick={() => setOpen(false)} />
          <div ref={drawerRef} className="animate-slide-in absolute inset-y-0 start-0 w-[86%] max-w-[18rem] border-e border-line bg-surface shadow-lg">
            <SidebarContent {...props} collapsed={false} isActive={isActive} />
          </div>
        </div>
      )}

      {bottom.length > 0 && (
        <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden print:hidden" aria-label={labels.quickNav} data-testid="bottom-nav">
          <ul className="mx-auto flex max-w-xl">
            {bottom.map((l) => (
              <li key={l.href} className="flex-1">
                <BottomItem href={l.href} label={labels.short[l.key] ?? l.label} active={isActive(l.href)} badge={l.badge} icon={l.icon} />
              </li>
            ))}
            <li className="flex-1">
              <button
                type="button"
                onClick={openDrawer}
                aria-expanded={open}
                aria-controls="mobile-nav"
                className={cn('relative flex h-16 w-full flex-col items-center justify-center gap-1 text-[11px] font-medium', moreActive ? 'text-ink' : 'text-muted')}
                data-testid="bottom-nav-more"
              >
                <Icon name="more" className="size-6" strokeWidth={moreActive ? 2 : 1.6} />
                <span>{labels.more}</span>
              </button>
            </li>
          </ul>
        </nav>
      )}

      {searchOpen && <CommandPalette links={[...props.links, ...props.accountLinks]} slug={org.slug} onClose={() => setSearchOpen(false)} />}
    </div>
  );
}

// ------------------------------------------------------------------ sidebar

function SidebarContent({
  links,
  accountLinks,
  groupLabels,
  labels,
  org,
  orgs,
  locations,
  currentLocationId,
  user,
  setup,
  signOutLabel,
  themeLabels,
  collapsed,
  isActive,
  onToggleCollapsed,
}: ShellProps & { collapsed: boolean; isActive: (href: string) => boolean; onToggleCollapsed?: () => void }) {
  const groups = GROUP_KEYS.filter((g) => links.some((l) => l.group === g));
  return (
    <nav className="flex h-full flex-col" aria-label={labels.navigation}>
      <div className={cn('flex h-14 shrink-0 items-center gap-2 border-b border-line', collapsed ? 'justify-center px-2' : 'px-3')}>
        <RestaurantSwitcher org={org} orgs={orgs} locations={locations} currentLocationId={currentLocationId} collapsed={collapsed} labels={labels} />
        {onToggleCollapsed && !collapsed && (
          <button type="button" onClick={onToggleCollapsed} className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink" aria-label="Collapse sidebar" title="Collapse sidebar" data-testid="sidebar-collapse">
            <Icon name="sidebar" />
          </button>
        )}
      </div>

      <div className="mn-scroll flex-1 overflow-y-auto overscroll-contain px-2 py-3">
        {setup && <SetupProgress setup={setup} collapsed={collapsed} active={isActive(setup.href)} />}
        {groups.map((g, gi) => (
          <div key={g} className={cn(gi > 0 && 'mt-4')}>
            {collapsed ? gi > 0 && <div className="mx-3 mb-3 h-px bg-line" aria-hidden /> : <p className="px-2.5 pb-1 text-[11px] font-medium tracking-wide text-muted uppercase">{groupLabels[g]}</p>}
            <ul className="space-y-px">
              {links
                .filter((l) => l.group === g)
                .map((l) => (
                  <li key={l.href}>
                    <NavLink link={l} active={isActive(l.href)} collapsed={collapsed} />
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </div>

      <div className={cn('shrink-0 border-t border-line p-2', collapsed && 'flex flex-col items-center gap-1')}>
        {collapsed && onToggleCollapsed && (
          <button type="button" onClick={onToggleCollapsed} className="flex size-9 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink" aria-label="Expand sidebar" title="Expand sidebar" data-testid="sidebar-expand">
            <Icon name="sidebar" className="rtl:-scale-x-100" />
          </button>
        )}
        <AccountArea user={user} accountLinks={accountLinks} collapsed={collapsed} signOutLabel={signOutLabel} themeLabels={themeLabels} />
      </div>
    </nav>
  );
}

function NavLink({ link: l, active, collapsed }: { link: SidebarLink; active: boolean; collapsed: boolean }) {
  return (
    <Link
      href={l.href}
      aria-current={active ? 'page' : undefined}
      title={collapsed ? l.label : undefined}
      className={cn(
        'group relative flex items-center gap-2.5 rounded-lg text-[13px] transition-colors',
        collapsed ? 'mx-auto size-10 justify-center' : 'min-h-8 px-2.5 py-1 pointer-coarse:min-h-11',
        active ? 'bg-surface-2 font-medium text-ink' : 'text-ink-2 hover:bg-surface-2/70 hover:text-ink',
      )}
    >
      {active && <span className="absolute inset-y-1.5 start-0 w-0.5 rounded-full bg-lime" aria-hidden />}
      <Icon name={l.icon} className={cn('size-[18px]', active ? 'text-ink' : 'text-muted group-hover:text-ink-2')} />
      <span className={cn('min-w-0 flex-1 truncate', collapsed && 'sr-only')}>{l.label}</span>
      <PendingDot />
      {!!l.badge &&
        (collapsed ? (
          <span className="absolute end-1 top-1 size-2 rounded-full bg-lime ring-2 ring-surface" aria-label={String(l.badge)} />
        ) : (
          <span className="rounded-md bg-lime px-1.5 text-[11px] leading-[18px] font-semibold text-lime-ink tabular-nums">{l.badge}</span>
        ))}
    </Link>
  );
}

function SetupProgress({ setup, collapsed, active }: { setup: { href: string; completed: number; total: number }; collapsed: boolean; active: boolean }) {
  const pct = Math.round((setup.completed / setup.total) * 100);
  if (collapsed)
    return (
      <Link href={setup.href} title={`Finish setup · ${setup.completed}/${setup.total}`} className="mx-auto mb-3 flex size-10 items-center justify-center rounded-lg bg-accent-soft text-accent" aria-label="Setup wizard">
        <Icon name="wand" className="size-[18px]" />
      </Link>
    );
  return (
    <Link
      href={setup.href}
      aria-current={active ? 'page' : undefined}
      className={cn('mb-3 block rounded-lg border px-3 py-2.5 transition-colors', active ? 'border-lime/60 bg-accent-soft' : 'border-line bg-surface-2/60 hover:border-line-strong')}
      data-testid="sidebar-setup"
    >
      <span className="flex items-center justify-between gap-2 text-[13px] font-medium text-ink">
        <span className="flex items-center gap-2">
          <Icon name="wand" className="text-accent" /> Setup wizard
        </span>
        <span className="text-xs text-muted tabular-nums">
          {setup.completed}/{setup.total}
        </span>
      </span>
      <span className="mt-2 block h-1 overflow-hidden rounded-full bg-surface-3">
        <span className="block h-full rounded-full bg-lime" style={{ width: `${pct}%` }} />
      </span>
    </Link>
  );
}

function RestaurantSwitcher({ org, orgs, locations, currentLocationId, collapsed, labels }: Pick<ShellProps, 'org' | 'orgs' | 'locations' | 'currentLocationId' | 'labels'> & { collapsed: boolean }) {
  const router = useRouter();
  const [, start] = useTransition();
  const location = locations.find((l) => l.id === currentLocationId);
  const items: MenuItem[] = [];
  if (locations.length > 1) {
    items.push({ type: 'label', label: 'Locations' });
    for (const l of locations)
      items.push({
        type: 'button',
        label: l.name,
        icon: l.id === currentLocationId ? 'check' : 'map',
        onSelect: () => {
          document.cookie = `mn_loc_${org.slug}=${l.id}; path=/; max-age=31536000; samesite=lax`;
          start(() => router.refresh());
        },
      });
  }
  if (orgs.length > 1) {
    if (items.length) items.push({ type: 'separator' });
    items.push({ type: 'label', label: 'Restaurants' });
    for (const o of orgs) items.push({ label: o.name, href: `/dashboard/${o.slug}`, icon: o.slug === org.slug ? 'check' : 'building' });
    items.push({ label: labels.switchRestaurant, href: '/dashboard?choose=1', icon: 'chevronUpDown' });
  }
  const face = (
    <>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-graphite text-[11px] font-bold text-lime dark:bg-lime dark:text-lime-ink" aria-hidden>
        {initials(org.name)}
      </span>
      {collapsed ? (
        <span className="sr-only" data-testid="current-org">
          {org.name}
        </span>
      ) : (
        <span className="min-w-0 flex-1 text-start">
          <span className="block truncate text-[13px] leading-tight font-semibold text-ink" data-testid="current-org" title={org.name}>
            {org.name}
          </span>
          <span className="block truncate text-[11px] leading-tight text-muted">{location?.name ?? labels.restaurant}</span>
        </span>
      )}
    </>
  );
  if (items.length === 0)
    return (
      <div className={cn('flex min-w-0 flex-1 items-center gap-2.5 p-1', collapsed && 'flex-none')} title={collapsed ? org.name : undefined}>
        {face}
      </div>
    );
  return (
    <Menu
      label={labels.switchRestaurant}
      align="start"
      className={cn('min-w-0', !collapsed && 'flex-1')}
      triggerClassName={cn('flex w-full min-w-0 items-center gap-2.5 rounded-lg p-1 text-start hover:bg-surface-2', collapsed && 'justify-center')}
      trigger={
        <>
          {face}
          {!collapsed && <Icon name="chevronUpDown" className="text-muted" />}
        </>
      }
      items={items}
      testId="restaurant-switcher"
    />
  );
}

function AccountArea({ user, accountLinks, collapsed, signOutLabel, themeLabels }: Pick<ShellProps, 'user' | 'accountLinks' | 'signOutLabel' | 'themeLabels'> & { collapsed: boolean }) {
  const [, start] = useTransition();
  const items: MenuItem[] = [
    { label: 'Account settings', href: '/account', icon: 'user' },
    ...accountLinks.map((l) => ({ label: l.label, href: l.href, icon: l.icon })),
    { type: 'separator' },
    { type: 'button', label: signOutLabel, icon: 'logout', onSelect: () => start(() => logoutAction()) },
  ];
  const avatar = (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-3 text-[11px] font-semibold text-ink-2" aria-hidden>
      {initials(user.name)}
    </span>
  );
  return (
    <div className={cn('flex items-center gap-1', collapsed && 'flex-col')}>
      <Link href="/account" className={cn('flex min-w-0 items-center gap-2.5 rounded-lg p-1 hover:bg-surface-2', !collapsed && 'flex-1')} data-testid="my-account-link" title={collapsed ? `${user.name} · ${user.email}` : user.email}>
        {avatar}
        <span className={cn('min-w-0', collapsed && 'sr-only')}>
          <span className="block truncate text-[13px] leading-tight font-medium text-ink">{user.name}</span>
          <span className="block truncate text-[11px] leading-tight text-muted capitalize">{user.role}</span>
        </span>
      </Link>
      <ThemeToggle labels={themeLabels} />
      <Menu
        label="Account menu"
        side="top"
        align={collapsed ? 'start' : 'end'}
        triggerClassName="flex size-9 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink pointer-coarse:size-10"
        trigger={<Icon name="moreVertical" />}
        header={
          <>
            <p className="truncate text-sm font-medium text-ink">{user.name}</p>
            <p className="truncate text-xs text-muted">{user.email}</p>
          </>
        }
        items={items}
        testId="account-menu"
      />
    </div>
  );
}

// ------------------------------------------------------------------ top bar

function TopBar({
  links,
  accountLinks,
  setup,
  org,
  labels,
  alerts,
  alertTotal,
  onOpenSearch,
  onOpenMenu,
  drawerOpen,
}: ShellProps & { alertTotal: number; isActive: (href: string) => boolean; onOpenSearch: () => void; onOpenMenu: (e: React.MouseEvent<HTMLElement>) => void; drawerOpen: boolean }) {
  const pathname = usePathname();
  const crumbs = useMemo(() => {
    // While setup is unfinished the wizard is not in either list (it has its own sidebar card).
    const setupLink: SidebarLink[] = setup ? [{ href: setup.href, label: 'Setup wizard', group: 'account', key: 'setup', icon: 'wand' }] : [];
    return breadcrumbs(pathname, [...links, ...accountLinks, ...setupLink], org);
  }, [pathname, links, accountLinks, org, setup]);
  const section = crumbs[crumbs.length - 1];
  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-line bg-bg/85 px-3 backdrop-blur-md sm:px-4 lg:px-8 print:hidden">
      {/* Phones: brand + current section. */}
      <Link href={links[0]?.href ?? '/dashboard'} aria-label="MenuNiva" className="shrink-0 lg:hidden">
        <LogoMark className="h-8 w-8" />
      </Link>
      <div className="min-w-0 flex-1 lg:hidden">
        <p className="truncate text-sm leading-tight font-semibold text-ink">{section?.label ?? org.name}</p>
        <p className="truncate text-[11px] leading-tight text-muted">{org.name}</p>
      </div>
      {/* Larger screens: breadcrumbs. */}
      <nav aria-label="Breadcrumb" className="hidden min-w-0 flex-1 lg:block" data-testid="breadcrumbs">
        <ol className="flex min-w-0 items-center gap-1.5 text-[13px]">
          {crumbs.map((c, i) => (
            <li key={c.href} className="flex min-w-0 items-center gap-1.5">
              {i > 0 && <Icon name="chevronRight" className="size-3.5 text-muted/60 rtl:rotate-180" />}
              {i === crumbs.length - 1 ? (
                <span className="truncate font-medium text-ink" aria-current="page">
                  {c.label}
                </span>
              ) : (
                <Link href={c.href} className="block min-h-6 truncate rounded py-0.5 leading-5 text-muted hover:text-ink">
                  {c.label}
                </Link>
              )}
            </li>
          ))}
        </ol>
      </nav>

      <button
        type="button"
        onClick={onOpenSearch}
        className="hidden h-8 w-56 items-center gap-2 rounded-lg border border-line bg-surface px-2.5 text-[13px] text-muted shadow-xs hover:border-line-strong md:flex"
        data-testid="open-search"
      >
        <Icon name="search" />
        <span className="flex-1 text-start">Search…</span>
        <kbd className="rounded border border-line bg-surface-2 px-1 text-[10px]">⌘K</kbd>
      </button>
      <button type="button" onClick={onOpenSearch} className="flex size-10 items-center justify-center rounded-lg text-ink-2 hover:bg-surface-2 md:hidden" aria-label="Search">
        <Icon name="search" className="size-5" />
      </button>

      <Menu
        label={alertTotal ? `Notifications (${alertTotal})` : 'Notifications'}
        triggerClassName="relative flex size-10 items-center justify-center rounded-lg text-ink-2 hover:bg-surface-2 hover:text-ink lg:size-9"
        trigger={
          <>
            <Icon name="bell" className="size-5 lg:size-[18px]" />
            {alertTotal > 0 && <span className="absolute end-0.5 top-0.5 min-w-4 rounded-full bg-lime px-1 text-center text-[10px] leading-4 font-bold text-lime-ink ring-2 ring-bg tabular-nums">{alertTotal > 99 ? '99+' : alertTotal}</span>}
          </>
        }
        header={<p className="text-sm font-semibold text-ink">Notifications</p>}
        items={
          alertTotal
            ? alerts.filter((a) => a.count > 0).map((a) => ({ label: a.label, href: a.href, icon: a.icon, hint: String(a.count) }))
            : [{ type: 'label', label: 'You’re all caught up' }]
        }
        testId="notifications"
      />

      <button
        type="button"
        className="flex size-10 shrink-0 items-center justify-center rounded-lg text-ink-2 hover:bg-surface-2 lg:hidden"
        aria-expanded={drawerOpen}
        aria-controls="mobile-nav"
        aria-label={drawerOpen ? labels.closeMenu : labels.openMenu}
        onClick={onOpenMenu}
        data-testid="mobile-menu-button"
      >
        <Icon name="sidebar" className="size-5" />
      </button>
    </header>
  );
}

type Crumb = { label: string; href: string };
function breadcrumbs(pathname: string, links: SidebarLink[], org: { name: string; slug: string }): Crumb[] {
  const base = `/dashboard/${org.slug}`;
  const crumbs: Crumb[] = [{ label: org.name, href: base }];
  if (pathname === base) {
    const home = links.find((l) => l.href === base);
    if (home) crumbs.push({ label: home.label, href: base });
    return crumbs;
  }
  const section = links.filter((l) => l.href !== base && (pathname === l.href || pathname.startsWith(`${l.href}/`))).sort((a, b) => b.href.length - a.href.length)[0];
  if (!section) return crumbs;
  crumbs.push({ label: section.label, href: section.href });
  const rest = pathname.slice(section.href.length + 1);
  if (!rest) return crumbs;
  const table = SUB_PAGES[section.href.slice(base.length + 1)] ?? {};
  const parts = rest.split('/');
  // Longest matching pattern first ("products/*" before "products").
  for (let n = parts.length; n > 0; n--) {
    const candidate = parts.slice(0, n);
    const key = Object.keys(table).find((k) => {
      const kp = k.split('/');
      return kp.length === candidate.length && kp.every((p, i) => p === '*' || p === candidate[i]);
    });
    if (key) {
      crumbs.push({ label: table[key], href: `${section.href}/${candidate.join('/')}` });
      break;
    }
  }
  return crumbs;
}

// ------------------------------------------------------------- search palette

function CommandPalette({ links, slug, onClose }: { links: SidebarLink[]; slug: string; onClose: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const base = `/dashboard/${slug}`;
  const has = (key: string) => links.some((l) => l.key === key);
  const actions: { label: string; href: string; icon: IconName; group: string }[] = [
    ...links.map((l) => ({ label: l.label, href: l.href, icon: l.icon, group: 'Go to' })),
    ...(has('menu') ? [{ label: 'Add a dish', href: `${base}/menu/products/new`, icon: 'plus' as IconName, group: 'Actions' }, { label: 'Prices & availability', href: `${base}/menu/quick`, icon: 'tag' as IconName, group: 'Actions' }, { label: 'Translations', href: `${base}/menu/translations`, icon: 'globe' as IconName, group: 'Actions' }] : []),
    ...(has('tables') ? [{ label: 'Print QR codes', href: `${base}/tables/print`, icon: 'print' as IconName, group: 'Actions' }] : []),
    ...(has('importStudio') ? [{ label: 'Import a menu', href: `${base}/import`, icon: 'import' as IconName, group: 'Actions' }] : []),
    ...(has('settings') ? [{ label: 'Branding', href: `${base}/settings/branding`, icon: 'photo' as IconName, group: 'Actions' }, { label: 'Ordering channels', href: `${base}/settings/channels`, icon: 'layers' as IconName, group: 'Actions' }] : []),
    { label: 'Account settings', href: '/account', icon: 'user', group: 'Actions' },
  ];
  const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const results = actions.filter((a) => fold(a.label).includes(fold(q.trim())));
  useEffect(() => setIndex(0), [q]);
  useEffect(() => {
    inputRef.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = overflow;
    };
  }, []);
  const go = (href: string) => {
    onClose();
    router.push(href);
  };
  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center p-3 pt-[12vh] sm:p-6 sm:pt-[14vh]" role="dialog" aria-modal="true" aria-label="Search" data-testid="command-palette">
      <button type="button" aria-hidden tabIndex={-1} className="animate-fade-in absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="animate-pop-in relative w-full max-w-lg overflow-hidden rounded-2xl border border-line bg-surface shadow-lg">
        <div className="flex items-center gap-2.5 border-b border-line px-4">
          <Icon name="search" className="text-muted" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setIndex((i) => Math.min(results.length - 1, i + 1));
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setIndex((i) => Math.max(0, i - 1));
              }
              if (e.key === 'Enter' && results[index]) go(results[index].href);
            }}
            placeholder="Search sections and actions…"
            aria-label="Search sections and actions"
            role="combobox"
            aria-expanded="true"
            aria-controls="command-results"
            className="h-12 min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-muted pointer-coarse:text-base"
          />
          <kbd className="rounded border border-line bg-surface-2 px-1.5 text-[10px] text-muted">Esc</kbd>
        </div>
        <ul id="command-results" role="listbox" className="mn-scroll max-h-[min(60vh,24rem)] overflow-y-auto p-1.5">
          {results.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted">No matches</li>}
          {results.map((r, i) => (
            <li key={`${r.group}${r.href}`} role="option" aria-selected={i === index}>
              <button
                type="button"
                onMouseEnter={() => setIndex(i)}
                onClick={() => go(r.href)}
                className={cn('flex min-h-10 w-full items-center gap-3 rounded-lg px-3 text-start text-sm', i === index ? 'bg-surface-2 text-ink' : 'text-ink-2')}
              >
                <Icon name={r.icon} className="text-muted" />
                <span className="flex-1 truncate">{r.label}</span>
                <span className="text-[11px] text-muted">{r.group}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- bottom bar

function BottomItem({ href, label, active, badge, icon }: { href: string; label: string; active: boolean; badge?: number; icon: IconName }) {
  return (
    <Link href={href} aria-current={active ? 'page' : undefined} className={cn('relative flex h-16 flex-col items-center justify-center gap-1 px-1 text-[11px] font-medium', active ? 'text-ink' : 'text-muted')}>
      <Icon name={icon} className="size-6" strokeWidth={active ? 2 : 1.6} />
      <span className="max-w-full truncate">{label}</span>
      <PendingBar />
      {!!badge && (
        <span className="absolute top-1.5 start-1/2 ms-2 min-w-5 rounded-full bg-lime px-1 text-center text-[10px] leading-5 font-semibold text-lime-ink tabular-nums" aria-label={`${badge}`}>
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </Link>
  );
}

/**
 * Immediate feedback while the next section is being prepared on the server: without it a tap
 * on a slow connection looked like it did nothing. (A route-level loading.tsx would also give
 * feedback, but it streams pages, which turns permission redirects into client-side refreshes.)
 */
function PendingDot() {
  const { pending } = useLinkStatus();
  return <span className={cn('size-1.5 shrink-0 rounded-full bg-current transition-opacity', pending ? 'animate-pulse opacity-70' : 'opacity-0')} aria-hidden />;
}
function PendingBar() {
  const { pending } = useLinkStatus();
  return <span className={cn('absolute inset-x-5 top-0 h-0.5 rounded-full bg-lime transition-opacity', pending ? 'animate-pulse opacity-100' : 'opacity-0')} aria-hidden />;
}
