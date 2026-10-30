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
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-4 px-6 py-3">
          <Link href="/admin" className="flex items-center gap-2">
            <Logo compact />
            <span className="font-semibold">MenuNiva</span>
            <Badge tone="lime">Super Admin</Badge>
          </Link>
          <nav className="flex flex-1 flex-wrap gap-1">
            {LINKS.map(([href, label]) => (
              <Link key={href} href={href} className="rounded-lg px-3 py-1.5 text-sm text-white/80 hover:bg-white/10 hover:text-white">
                {label}
              </Link>
            ))}
          </nav>
          <span className="text-xs text-white/60">{admin.email}</span>
          <form action={logoutAction}>
            <button className="rounded-lg px-3 py-1.5 text-sm text-white/80 hover:bg-white/10">Sign out</button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
    </div>
  );
}
