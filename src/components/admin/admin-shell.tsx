'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { logoutAction } from '@/app/(auth)/actions';
import { LogoMark } from '@/components/brand/logo';
import { ThemeToggle } from '@/components/dashboard/theme-toggle';
import { Icon, type IconName } from '@/components/ui/icons';
import { cn } from '@/lib/cn';

export type AdminLink = { href: string; label: string; icon: IconName; group: 'platform' | 'operations' };

const GROUPS = [
  ['platform', 'Platform'],
  ['operations', 'Operations'],
] as const;

/**
 * Super Admin shell: same structure as the restaurant dashboard (sidebar on desktop, drawer on
 * phones and tablets) so the two areas feel like one product, with a clear "Super Admin" mark.
 */
export function AdminShell({ links, email, children }: { links: AdminLink[]; email: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    drawerRef.current?.querySelector<HTMLElement>('a[aria-current=page], a[href]')?.focus();
    const opener = openerRef.current;
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      opener?.focus();
    };
  }, [open]);

  // "/admin" is only active on itself; tenant detail pages belong to "Tenants".
  const isActive = (href: string) => (href === '/admin' ? pathname === '/admin' || (pathname.startsWith('/admin/tenants/') && pathname !== '/admin/tenants/new') : pathname === href || pathname.startsWith(`${href}/`));
  const current = links.find((l) => isActive(l.href));

  return (
    <div className="min-h-dvh lg:flex" lang="en" dir="ltr">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 border-e border-line bg-surface lg:block">
        <Sidebar links={links} email={email} isActive={isActive} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-bg/85 px-4 backdrop-blur sm:px-6 lg:px-8 print:hidden">
          <button
            ref={openerRef}
            type="button"
            onClick={() => setOpen(true)}
            className="-ms-1.5 flex size-9 items-center justify-center rounded-lg text-ink-2 hover:bg-surface-2 lg:hidden pointer-coarse:size-11"
            aria-label="Open navigation"
            aria-expanded={open}
            aria-controls="admin-nav"
          >
            <Icon name="sidebar" />
          </button>
          <nav aria-label="Breadcrumb" className="min-w-0 flex-1 text-[13px]">
            <ol className="flex min-w-0 items-center gap-1.5">
              <li className="shrink-0 text-muted">Super Admin</li>
              {current && (
                <>
                  <li aria-hidden className="text-muted/60">
                    <Icon name="chevronRight" className="size-3.5" />
                  </li>
                  <li className="truncate font-medium text-ink" aria-current="page">
                    {current.label}
                  </li>
                </>
              )}
            </ol>
          </nav>
          <span className="hidden max-w-56 truncate text-xs text-muted md:inline" title={email}>
            {email}
          </span>
        </header>
        <main id="main" className="mx-auto w-full max-w-[90rem] flex-1 px-4 pt-5 pb-10 sm:px-6 lg:px-8 lg:pt-7">
          {children}
        </main>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" id="admin-nav" role="dialog" aria-modal="true" aria-label="Navigation">
          <button type="button" aria-hidden tabIndex={-1} className="animate-fade-in absolute inset-0 bg-black/45" onClick={() => setOpen(false)} />
          <div ref={drawerRef} className="animate-slide-in absolute inset-y-0 start-0 w-[86%] max-w-[18rem] border-e border-line bg-surface shadow-lg">
            <Sidebar links={links} email={email} isActive={isActive} />
          </div>
        </div>
      )}
    </div>
  );
}

function Sidebar({ links, email, isActive }: { links: AdminLink[]; email: string; isActive: (href: string) => boolean }) {
  const [pending, start] = useTransition();
  return (
    <div className="flex h-full flex-col">
      <Link href="/admin" className="flex h-14 shrink-0 items-center gap-2.5 border-b border-line px-4">
        <LogoMark className="size-8" />
        <span className="min-w-0">
          <span className="block text-[13px] leading-tight font-semibold text-ink">MenuNiva</span>
          <span className="mt-0.5 inline-flex items-center gap-1 rounded bg-lime px-1.5 text-[10px] leading-4 font-semibold text-lime-ink">
            <Icon name="shield" className="size-2.5" /> Super Admin
          </span>
        </span>
      </Link>
      <nav className="mn-scroll flex-1 overflow-y-auto px-2 py-3" aria-label="Super Admin">
        {GROUPS.map(([g, label], gi) => (
          <div key={g} className={cn(gi > 0 && 'mt-4')}>
            <p className="px-2.5 pb-1 text-[11px] font-medium tracking-wide text-muted uppercase">{label}</p>
            <ul className="space-y-px">
              {links
                .filter((l) => l.group === g)
                .map((l) => {
                  const active = isActive(l.href);
                  return (
                    <li key={l.href}>
                      <Link
                        href={l.href}
                        aria-current={active ? 'page' : undefined}
                        className={cn(
                          'group relative flex min-h-8 items-center gap-2.5 rounded-lg px-2.5 py-1 text-[13px] transition-colors pointer-coarse:min-h-11',
                          active ? 'bg-surface-2 font-medium text-ink' : 'text-ink-2 hover:bg-surface-2/70 hover:text-ink',
                        )}
                      >
                        {active && <span className="absolute inset-y-1.5 start-0 w-0.5 rounded-full bg-lime" aria-hidden />}
                        <Icon name={l.icon} className={cn('size-[18px]', active ? 'text-ink' : 'text-muted group-hover:text-ink-2')} />
                        <span className="truncate">{l.label}</span>
                      </Link>
                    </li>
                  );
                })}
            </ul>
          </div>
        ))}
      </nav>
      <div className="flex shrink-0 items-center gap-1 border-t border-line p-2">
        <span className="flex min-w-0 flex-1 items-center gap-2.5 p-1">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-3 text-ink-2" aria-hidden>
            <Icon name="user" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[13px] leading-tight font-medium text-ink" title={email}>
              {email}
            </span>
            <span className="block text-[11px] leading-tight text-muted">Platform admin</span>
          </span>
        </span>
        <ThemeToggle labels={{ dark: 'Dark mode', light: 'Light mode' }} />
        <button
          type="button"
          disabled={pending}
          onClick={() => start(() => logoutAction())}
          className="flex size-9 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink disabled:opacity-50 pointer-coarse:size-10"
          aria-label="Sign out"
          title="Sign out"
        >
          <Icon name="logout" />
        </button>
      </div>
    </div>
  );
}
