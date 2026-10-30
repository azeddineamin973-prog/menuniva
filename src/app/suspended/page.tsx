import { Logo } from '@/components/brand/logo';
import { Card, CardBody } from '@/components/ui';

export default function SuspendedPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6">
      <Logo className="mb-6" />
      <Card>
        <CardBody>
          <h1 className="text-xl font-semibold">This restaurant account is suspended</h1>
          <p className="mt-2 text-sm text-muted">
            Access to the dashboard is paused. Your data is kept safely. Please contact MenuNiva support to reactivate the
            account.
          </p>
        </CardBody>
      </Card>
    </main>
  );
}
