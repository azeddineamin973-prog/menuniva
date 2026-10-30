'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Logo } from '@/components/brand/logo';
import { cn } from '@/lib/cn';

export type SidebarLink = { href: string; label: string; group: string; badge?: number };

const GROUP_KEYS = ['operate', 'menu', 'grow', 'manage'];

export function Sidebar({
  links,
  orgName,
  orgSwitcher,
  footer,
  groupLabels,
}: {
  groupLabels: Record<string, string>;
  links: SidebarLink[];
  orgName: string;
  orgSwitcher?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);

  const groups = GROUP_KEYS.filter((g) => links.some((l) => l.group === g));
  const isActive = (href: string) => {
    const base = links[0]?.href;
    return href === base ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  };

  const nav = (
    <nav className="flex h-full flex-col">
      <div className="flex h-16 items-center px-5">
        <Logo />
      </div>
      <div className="px-3 pb-3">
        <div className="rounded-2xl border border-line bg-surface-2 px-3 py-2.5">
          <p className="text-[11px] tracking-wide text-muted uppercase">Restaurant</p>
          <p className="truncate text-sm font-semibold" data-testid="current-org">
            {orgName}
          </p>
          {orgSwitcher}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-3 pb-4">
        {groups.map((g) => (
          <div key={g} className="mt-4 first:mt-1">
            <p className="px-3 pb-1.5 text-[11px] font-medium tracking-wide text-muted uppercase">{groupLabels[g]}</p>
            <ul className="space-y-0.5">
              {links
                .filter((l) => l.group === g)
                .map((l) => (
                  <li key={l.href}>
                    <Link
                      href={l.href}
                      className={cn(
                        'flex items-center justify-between rounded-xl px-3 py-2 text-sm transition-colors',
                        isActive(l.href) ? 'bg-graphite font-medium text-white dark:bg-lime dark:text-graphite' : 'text-ink/80 hover:bg-surface-2 hover:text-ink',
                      )}
                    >
                      <span>{l.label}</span>
                      {!!l.badge && (
                        <span className="rounded-full bg-lime px-1.5 text-[11px] font-semibold text-graphite tabular-nums">{l.badge}</span>
                      )}
                    </Link>
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </div>
      {footer && <div className="border-t border-line p-3">{footer}</div>}
    </nav>
  );

  return (
    <>
      <div className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-surface/90 px-4 backdrop-blur lg:hidden">
        <Logo />
        <button
          type="button"
          className="rounded-xl border border-line px-3 py-1.5 text-sm"
          aria-expanded={open}
          aria-controls="mobile-nav"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? 'Close' : 'Menu'}
        </button>
      </div>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" id="mobile-nav">
          <button aria-label="Close menu" className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 start-0 w-[82%] max-w-xs border-e border-line bg-surface">{nav}</div>
        </div>
      )}
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 border-e border-line bg-surface lg:block">{nav}</aside>
    </>
  );
}
