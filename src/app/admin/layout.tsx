import type { Metadata } from 'next';
import { AdminShell, type AdminLink } from '@/components/admin/admin-shell';
import { requirePlatformAdminPage } from '@/server/tenant';

export const metadata: Metadata = { title: 'Super Admin', robots: { index: false, follow: false } };

const LINKS: AdminLink[] = [
  { href: '/admin', label: 'Tenants', icon: 'building', group: 'platform' },
  { href: '/admin/tenants/new', label: 'New tenant', icon: 'plus', group: 'platform' },
  { href: '/admin/plans', label: 'Plans', icon: 'card', group: 'platform' },
  { href: '/admin/settings', label: 'Platform settings', icon: 'settings', group: 'platform' },
  { href: '/admin/health', label: 'Integrations & errors', icon: 'activity', group: 'operations' },
  { href: '/admin/support', label: 'Support', icon: 'help', group: 'operations' },
  { href: '/admin/audit', label: 'Audit log', icon: 'book', group: 'operations' },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requirePlatformAdminPage();
  return (
    <AdminShell links={LINKS} email={admin.email}>
      {children}
    </AdminShell>
  );
}
