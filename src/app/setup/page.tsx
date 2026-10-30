import type { Metadata } from 'next';
import { Logo } from '@/components/brand/logo';
import { Alert, Card, CardBody } from '@/components/ui';
import { isSetupTokenUsable } from '@/server/services/platform-setup';
import { SetupForm } from './setup-form';

export const metadata: Metadata = { title: 'Platform setup', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function SetupPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = '' } = await searchParams;
  const usable = await isSetupTokenUsable(token);
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-10">
      <Logo className="mb-8" />
      <Card>
        <CardBody className="space-y-5">
          <div>
            <h1 className="text-xl font-semibold">Create the MenuNiva Super Admin</h1>
            <p className="mt-1 text-sm text-muted">
              This one-time page creates the platform administrator account. It works only with a valid setup link
              generated on the server with <code className="font-mono">npm run setup:admin-token</code>.
            </p>
          </div>
          {usable ? (
            <SetupForm token={token} />
          ) : (
            <Alert tone="warning" title="This setup link is not valid">
              It may have expired, been used already, or an administrator already exists.
            </Alert>
          )}
        </CardBody>
      </Card>
    </main>
  );
}
