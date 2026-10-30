import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Logo } from '@/components/brand/logo';
import { Card, CardBody } from '@/components/ui';
import { getCurrentUser } from '@/server/auth/session';
import { getPlatformConfig } from '@/server/services/platform-config';
import { RegisterRestaurantForm } from './register-form';

export const metadata: Metadata = { title: 'Register your restaurant', robots: { index: false } };

export default async function NewRestaurantPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login?next=/onboarding/new');
  const config = await getPlatformConfig();
  return (
    <main className="mx-auto max-w-lg px-6 py-12">
      <Logo className="mb-8" />
      <p className="text-sm font-medium text-muted">Step 1 of 10</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">Register your restaurant</h1>
      <p className="mt-2 text-sm text-muted">
        Start with the basics. You can change everything later. Your restaurant stays private until you publish it.
      </p>
      <Card className="mt-6">
        <CardBody>
          {config.signupsOpen ? (
            <RegisterRestaurantForm />
          ) : (
            <p className="text-sm" data-testid="signups-closed">
              New restaurant registrations are paused.{config.supportEmail ? <> Contact <a className="underline" href={`mailto:${config.supportEmail}`}>{config.supportEmail}</a>.</> : ' Please contact MenuNiva support.'}
            </p>
          )}
        </CardBody>
      </Card>
    </main>
  );
}
