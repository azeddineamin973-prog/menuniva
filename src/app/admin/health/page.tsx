import { Badge, Card, CardBody, CardHeader, Field, Input, PageHeader } from '@/components/ui';
import { db } from '@/server/db';
import { integrationHealth } from '@/server/services/admin';
import { adminResetLinkAction } from '../actions';
import { LinkResultForm } from '@/components/forms/link-result-form';
import { requirePlatformAdminPage } from '@/server/tenant';

export const dynamic = 'force-dynamic';

export default async function HealthPage() {
  // Layout checks are not re-run on client navigation, so every admin page checks itself.
  await requirePlatformAdminPage();
  const errors = await db.errorLog.findMany({ orderBy: { createdAt: 'desc' }, take: 50 });
  return (
    <>
      <PageHeader title="Integrations & system errors" description="Status reflects real configuration. Nothing is shown as connected unless it is." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Integration health" />
          <ul className="divide-y divide-line text-sm">
            {integrationHealth().map((i) => (
              <li key={i.name} className="flex items-start justify-between gap-3 px-5 py-3">
                <span className="min-w-0">
                  <span className="font-medium">{i.name}</span>
                  <span className="block text-xs text-muted">{i.note}</span>
                </span>
                <Badge tone={i.status === 'CONNECTED' ? 'success' : i.status.startsWith('NOT') ? 'neutral' : 'info'}>{i.status}</Badge>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHeader title="Password reset link" description="While email is not configured, create a single-use reset link (30 minutes) and give it to the user personally." />
          <CardBody>
            <LinkResultForm action={adminResetLinkAction} submitLabel="Create reset link" note="Single-use, valid 30 minutes:">
              <Field label="User email" htmlFor="email"><Input id="email" name="email" type="email" required /></Field>
            </LinkResultForm>
          </CardBody>
        </Card>
      </div>
      <Card className="mt-6">
        <CardHeader title="Recent server errors" description={`${errors.length} shown`} />
        {errors.length === 0 ? (
          <CardBody className="text-sm text-muted">No errors recorded.</CardBody>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {errors.map((e) => (
              <li key={e.id} className="px-5 py-3">
                <div className="flex flex-wrap justify-between gap-2">
                  <span className="font-mono text-xs break-all">{e.source}</span>
                  <span className="text-xs text-muted">{e.createdAt.toISOString().replace('T', ' ').slice(0, 19)} UTC</span>
                </div>
                <p className="mt-1 text-sm break-words">{e.message}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
