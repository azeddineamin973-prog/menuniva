import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Logo } from '@/components/brand/logo';
import { SubmitButton } from '@/components/forms/submit-button';
import { Alert, ButtonLink, Card, CardBody } from '@/components/ui';
import { getCurrentUser } from '@/server/auth/session';
import { acceptInvitation, findInvitation } from '@/server/services/invitations';
import { UserFacingError } from '@/server/errors';

export const metadata: Metadata = { title: 'Invitation', robots: { index: false } };
export const dynamic = 'force-dynamic';

const ROLE_LABEL: Record<string, string> = {
  RESTAURANT_OWNER: 'Owner',
  RESTAURANT_MANAGER: 'Manager',
  WAITER: 'Waiter',
  KITCHEN_STAFF: 'Kitchen staff',
  CAFE_STAFF: 'Café staff',
  DELIVERY_STAFF: 'Delivery staff',
};

export default async function InvitePage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ error?: string }> }) {
  const { token } = await params;
  const { error } = await searchParams;
  const inv = await findInvitation(token);
  const user = await getCurrentUser();

  async function accept() {
    'use server';
    const u = await getCurrentUser();
    if (!u) redirect(`/login?next=/invite/${token}`);
    let slug: string;
    try {
      slug = await acceptInvitation(token, u);
    } catch (e) {
      const msg = e instanceof UserFacingError ? e.code : 'This invitation could not be accepted.';
      redirect(`/invite/${token}?error=${encodeURIComponent(msg)}`);
    }
    redirect(`/dashboard/${slug}`);
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6">
      <Logo className="mb-6" />
      <Card>
        <CardBody className="space-y-4">
          {!inv ? (
            <Alert tone="warning" title="Invitation not valid">It may have expired, been revoked or already used.</Alert>
          ) : (
            <>
              <h1 className="text-xl font-semibold">Join {inv.organization.name}</h1>
              <p className="text-sm text-muted">
                You have been invited as <strong>{ROLE_LABEL[inv.role]}</strong> using the email <strong>{inv.email}</strong>.
              </p>
              {error && <Alert tone="danger">{error}</Alert>}
              {user ? (
                <form action={accept}>
                  <SubmitButton size="lg" className="w-full" pendingLabel="Joining…" data-testid="accept-invitation">
                    Accept invitation
                  </SubmitButton>
                  <p className="mt-2 text-xs text-muted">Signed in as {user.email}</p>
                </form>
              ) : (
                <div className="flex gap-2">
                  <ButtonLink href={`/signup?next=/invite/${token}`} className="flex-1">Create account</ButtonLink>
                  <ButtonLink href={`/login?next=/invite/${token}`} variant="secondary" className="flex-1">Sign in</ButtonLink>
                </div>
              )}
            </>
          )}
        </CardBody>
      </Card>
    </main>
  );
}
