'use client';

import Link, { useLinkStatus } from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Logo } from '@/components/brand/logo';
import { cn } from '@/lib/cn';

export type SidebarLink = { href: string; label: string; group: string; key: string; badge?: number };
export type ShellLabels = {
  more: string;
  openMenu: string;
  closeMenu: string;
  restaurant: string;
  navigation: string;
  quickNav: string;
  short: Record<string, string>;
};

const GROUP_KEYS = ['operate', 'menu', 'grow', 'manage'];
/**
 * Sections that earn a place in the phone bottom bar, most used first. Each person sees the first
 * four their role can open (a cook gets Kitchen, a driver their deliveries); everything else stays
 * one tap away under "More".
 */
const BOTTOM_PRIORITY = ['liveOrders', 'kitchen', 'myDeliveries', 'tables', 'menu', 'tasks', 'reservations', 'bills', 'overview'];

export function Sidebar({
  links,
  orgName,
  orgSwitcher,
  footer,
  groupLabels,
  labels,
}: {
  groupLabels: Record<string, string>;
  links: SidebarLink[];
  orgName: string;
  orgSwitcher?: React.ReactNode;
  footer?: React.ReactNode;
  labels: ShellLabels;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
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

  const groups = GROUP_KEYS.filter((g) => links.some((l) => l.group === g));
  const home = links[0]?.href;
  const isActive = (href: string) => (href === home ? pathname === href : pathname === href || pathname.startsWith(`${href}/`));
  const bottom = BOTTOM_PRIORITY.map((k) => links.find((l) => l.key === k)).filter((l): l is SidebarLink => !!l).slice(0, 4);
  // "More" is highlighted when the current page is not one of the bottom-bar sections.
  const moreActive = !bottom.some((l) => isActive(l.href));
  const toggle = (e: React.MouseEvent<HTMLElement>) => {
    openerRef.current = e.currentTarget;
    setOpen((v) => !v);
  };

  const nav = (
    <nav className="flex h-full flex-col" aria-label={labels.navigation}>
      <div className="flex h-16 shrink-0 items-center px-5">
        {home ? (
          <Link href={home} aria-label="MenuNiva">
            <Logo />
          </Link>
        ) : (
          <Logo />
        )}
      </div>
      <div className="px-3 pb-3">
        <div className="rounded-2xl border border-line bg-surface-2 px-3 py-2.5">
          <p className="text-[11px] tracking-wide text-muted uppercase">{labels.restaurant}</p>
          <p className="truncate text-sm font-semibold" data-testid="current-org" title={orgName}>
            {orgName}
          </p>
          {orgSwitcher}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto overscroll-contain px-3 pb-4">
        {groups.map((g) => (
          <div key={g} className="mt-3 first:mt-1">
            <p className="px-3 pb-1 text-[11px] font-medium tracking-wide text-muted uppercase">{groupLabels[g]}</p>
            <ul className="space-y-0.5">
              {links
                .filter((l) => l.group === g)
                .map((l) => (
                  <li key={l.href}>
                    <Link
                      href={l.href}
                      aria-current={isActive(l.href) ? 'page' : undefined}
                      className={cn(
                        'flex min-h-9 items-center justify-between gap-2 rounded-xl px-3 py-1.5 text-sm transition-colors pointer-coarse:min-h-11',
                        isActive(l.href) ? 'bg-graphite font-medium text-white dark:bg-lime dark:text-graphite' : 'text-ink/80 hover:bg-surface-2 hover:text-ink',
                      )}
                    >
                      <span className="truncate">{l.label}</span>
                      <span className="flex items-center gap-1.5">
                        <PendingDot />
                        {!!l.badge && <span className="rounded-full bg-lime px-1.5 text-[11px] font-semibold text-graphite tabular-nums">{l.badge}</span>}
                      </span>
                    </Link>
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </div>
      {footer && <div className="shrink-0 border-t border-line p-3">{footer}</div>}
    </nav>
  );

  return (
    <>
      <div className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-line bg-surface/90 px-4 backdrop-blur lg:hidden">
        {home ? (
          <Link href={home} aria-label="MenuNiva" className="shrink-0">
            <Logo />
          </Link>
        ) : (
          <Logo />
        )}
        <p className="min-w-0 truncate text-sm font-medium text-muted" title={orgName}>
          {orgName}
        </p>
        <button
          type="button"
          className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-line text-ink"
          aria-expanded={open}
          aria-controls="mobile-nav"
          aria-label={open ? labels.closeMenu : labels.openMenu}
          onClick={toggle}
          data-testid="mobile-menu-button"
        >
          <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            {open ? <path d="M6 6l12 12M18 6 6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
          </svg>
        </button>
      </div>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" id="mobile-nav" role="dialog" aria-modal="true" aria-label={labels.openMenu}>
          <button type="button" aria-hidden tabIndex={-1} title={labels.closeMenu} className="absolute inset-0 bg-black/45" onClick={() => setOpen(false)} />
          <div ref={drawerRef} className="absolute inset-y-0 start-0 w-[84%] max-w-xs border-e border-line bg-surface shadow-xl">
            {nav}
          </div>
        </div>
      )}
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 border-e border-line bg-surface lg:block">{nav}</aside>
      {bottom.length > 0 && (
        <nav
          className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden print:hidden"
          aria-label={labels.quickNav}
          data-testid="bottom-nav"
        >
          <ul className="mx-auto flex max-w-xl">
            {bottom.map((l) => (
              <li key={l.href} className="flex-1">
                <BottomItem href={l.href} label={labels.short[l.key] ?? l.label} active={isActive(l.href)} badge={l.badge} icon={l.key} />
              </li>
            ))}
            <li className="flex-1">
              <button
                type="button"
                onClick={toggle}
                aria-expanded={open}
                aria-controls="mobile-nav"
                className={cn('relative flex h-16 w-full flex-col items-center justify-center gap-1 text-[11px] font-medium', moreActive ? 'text-ink' : 'text-muted')}
                data-testid="bottom-nav-more"
              >
                <NavIcon name="more" active={moreActive} />
                <span>{labels.more}</span>
              </button>
            </li>
          </ul>
        </nav>
      )}
    </>
  );
}

function BottomItem({ href, label, active, badge, icon }: { href: string; label: string; active: boolean; badge?: number; icon: string }) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn('relative flex h-16 flex-col items-center justify-center gap-1 px-1 text-[11px] font-medium', active ? 'text-ink' : 'text-muted')}
    >
      <NavIcon name={icon} active={active} />
      <span className="max-w-full truncate">{label}</span>
      <PendingBar />
      {!!badge && (
        <span className="absolute top-1.5 start-1/2 ms-2 min-w-5 rounded-full bg-lime px-1 text-center text-[10px] leading-5 font-semibold text-graphite tabular-nums" aria-label={`${badge}`}>
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
  return <span className={cn('size-1.5 rounded-full bg-current transition-opacity', pending ? 'animate-pulse opacity-70' : 'opacity-0')} aria-hidden />;
}
function PendingBar() {
  const { pending } = useLinkStatus();
  return <span className={cn('absolute inset-x-5 top-0 h-0.5 rounded-full bg-lime transition-opacity', pending ? 'animate-pulse opacity-100' : 'opacity-0')} aria-hidden />;
}

/** Simple line icons for the bottom bar (original, 24 × 24). */
function NavIcon({ name, active }: { name: string; active: boolean }) {
  const paths: Record<string, React.ReactNode> = {
    liveOrders: (
      <>
        <rect x="5" y="3.5" width="14" height="17" rx="2.5" />
        <path d="M9 8.5h6M9 12h6M9 15.5h3.5" />
      </>
    ),
    kitchen: (
      <>
        <path d="M4.5 15.5a7.5 7.5 0 0 1 15 0z" />
        <path d="M3 18.5h18M12 6v2" />
      </>
    ),
    myDeliveries: (
      <>
        <path d="M3 7h11v9H3zM14 10h4l3 3v3h-7" />
        <circle cx="7" cy="17.5" r="1.8" />
        <circle cx="17" cy="17.5" r="1.8" />
      </>
    ),
    tables: (
      <>
        <rect x="4" y="4" width="6.5" height="6.5" rx="1.2" />
        <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.2" />
        <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.2" />
        <path d="M14 14h2.5v2.5H14zM18 18h2M18 14v2" />
      </>
    ),
    menu: (
      <>
        <path d="M6 3.5h12a1.5 1.5 0 0 1 1.5 1.5v14a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 19V5A1.5 1.5 0 0 1 6 3.5z" />
        <path d="M8.5 8h7M8.5 11.5h7M8.5 15h4" />
      </>
    ),
    tasks: (
      <>
        <path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z" />
        <path d="M10 20.5a2 2 0 0 0 4 0" />
      </>
    ),
    reservations: (
      <>
        <rect x="4" y="5" width="16" height="15" rx="2.5" />
        <path d="M4 9.5h16M8.5 3v4M15.5 3v4" />
      </>
    ),
    bills: (
      <>
        <path d="M6 3.5h12v17l-3-2-3 2-3-2-3 2z" />
        <path d="M9 8.5h6M9 12h6" />
      </>
    ),
    overview: (
      <>
        <path d="M4 11.5 12 4.5l8 7" />
        <path d="M6.5 10v9.5h11V10" />
      </>
    ),
    more: (
      <>
        <circle cx="5.5" cy="12" r="1.4" />
        <circle cx="12" cy="12" r="1.4" />
        <circle cx="18.5" cy="12" r="1.4" />
      </>
    ),
  };
  return (
    <svg viewBox="0 0 24 24" className={cn('size-6', active && 'text-ink')} fill="none" stroke="currentColor" strokeWidth={active ? 2 : 1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {paths[name] ?? paths.more}
    </svg>
  );
}
