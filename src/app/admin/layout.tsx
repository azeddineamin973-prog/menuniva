import type { Metadata } from 'next';
import Link from 'next/link';
import { logoutAction } from '@/app/(auth)/actions';
import { Logo } from '@/components/brand/logo';
import { Badge } from '@/components/ui';
import { requirePlatformAdminPage } from '@/server/tenant';

export const metadata: Metadata = { title: 'Super Admin', robots: { index: false, follow: false } };

const LINKS = [
  ['/admin', 'Tenants'],
  ['/admin/tenants/new', 'New tenant'],
  ['/admin/plans', 'Plans'],
  ['/admin/health', 'Integrations & errors'],
  ['/admin/support', 'Support'],
  ['/admin/audit', 'Audit log'],
  ['/admin/settings', 'Platform settings'],
] as const;

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requirePlatformAdminPage();
  return (
    <div className="min-h-dvh" lang="en" dir="ltr">
      <header className="border-b border-line bg-graphite text-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
          <Link href="/admin" className="flex items-center gap-2">
            <Logo compact />
            <span className="font-semibold">MenuNiva</span>
            {/* Solid lime: the translucent lime badge was unreadable on the graphite header. */}
            <Badge tone="brand">Super Admin</Badge>
          </Link>
          <div className="ms-auto flex items-center gap-2 lg:order-last">
            <span className="hidden max-w-48 truncate text-xs text-white/60 sm:inline" title={admin.email}>
              {admin.email}
            </span>
            <form action={logoutAction}>
              <button className="inline-flex min-h-9 items-center rounded-lg px-3 text-sm text-white/80 hover:bg-white/10 pointer-coarse:min-h-10">Sign out</button>
            </form>
          </div>
          {/* One scrollable row on phones instead of four wrapped rows of links. */}
          <nav className="-mx-4 flex w-[calc(100%+2rem)] min-w-0 gap-1 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:w-full sm:px-0 lg:w-auto lg:flex-1" aria-label="Super Admin">
            {LINKS.map(([href, label]) => (
              <Link key={href} href={href} className="inline-flex min-h-9 shrink-0 items-center rounded-lg px-3 text-sm whitespace-nowrap text-white/80 hover:bg-white/10 hover:text-white pointer-coarse:min-h-10">
                {label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
    </div>
  );
}
