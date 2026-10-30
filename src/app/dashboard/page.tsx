import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Logo } from '@/components/brand/logo';
import { Badge, ButtonLink, Card } from '@/components/ui';
import { getCurrentUser } from '@/server/auth/session';
import { listUserOrganizations } from '@/server/services/organizations';

export const dynamic = 'force-dynamic';

/** Sends each signed-in user to the right place: their restaurant, a chooser, onboarding or Super Admin. */
export default async function DashboardRouter({ searchParams }: { searchParams: Promise<{ choose?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login?next=/dashboard');
  const { choose } = await searchParams;
  const memberships = await listUserOrganizations(user.id);
  const isAdmin = user.platformRole === 'PLATFORM_SUPER_ADMIN';

  if (!choose) {
    if (memberships.length === 1) redirect(`/dashboard/${memberships[0].organization.slug}`);
    if (memberships.length === 0) redirect(isAdmin ? '/admin' : '/onboarding/new');
  }

  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <Logo className="mb-8" />
      <h1 className="text-2xl font-semibold">Choose a restaurant</h1>
      <div className="mt-6 space-y-3">
        {memberships.map((ms) => (
          <Link key={ms.id} href={`/dashboard/${ms.organization.slug}`} className="block">
            <Card className="flex items-center justify-between px-5 py-4 hover:bg-surface-2">
              <span className="font-medium">{ms.organization.name}</span>
              <span className="flex gap-2">
                {ms.organization.isDemo && <Badge tone="warning">Demo</Badge>}
                <Badge>{ms.role.replace('RESTAURANT_', '').toLowerCase()}</Badge>
              </span>
            </Card>
          </Link>
        ))}
      </div>
      <div className="mt-6 flex gap-3">
        <ButtonLink href="/onboarding/new" variant="secondary">
          Register another restaurant
        </ButtonLink>
        {isAdmin && <ButtonLink href="/admin" variant="dark">Super Admin</ButtonLink>}
      </div>
    </main>
  );
}
