import Link from 'next/link';
import { ActionForm } from '@/components/forms/action-form';
import { Badge, Card, CardBody, CardHeader, PageHeader } from '@/components/ui';
import { adapterStatuses, listImportJobs } from '@/server/import/service';
import { requireModulePage } from '@/server/module-page';
import { requireTenantPage } from '@/server/tenant';
import { createImportJobAction } from './actions';

const STATUS_TONE = { CONNECTED: 'success', LIMITED: 'warning', NOT_CONFIGURED: 'neutral', ERROR: 'danger' } as const;
const STATUS_LABEL = { CONNECTED: 'Available', LIMITED: 'Limited', NOT_CONFIGURED: 'Not connected', ERROR: 'Error' } as const;
const JOB_TONE = { DRAFT: 'neutral', NEEDS_REVIEW: 'warning', PUBLISHED: 'success', CANCELLED: 'neutral', FAILED: 'danger' } as const;

export default async function ImportStudioPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await requireTenantPage(org, 'import.manage');
  await requireModulePage(ctx, 'import');
  const [jobs, adapters] = await Promise.all([listImportJobs(ctx), Promise.resolve(adapterStatuses())]);
  const base = `/dashboard/${ctx.org.slug}`;
  return (
    <>
      <PageHeader
        title="Menu Import Studio"
        description="Bring in your existing menu instead of typing it again. Every item is reviewed by you before it is published; nothing goes live automatically."
        actions={
          <ActionForm action={createImportJobAction} submitLabel="Start a new import" testId="new-import-form">
            <input type="hidden" name="org" value={ctx.org.slug} />
          </ActionForm>
        }
      />
      <Card className="mb-6">
        <CardHeader title="Import sources" description="Status reflects what genuinely works today." />
        <ul className="grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-4">
          {adapters.map((a) => (
            <li key={a.type} className="bg-surface p-4" data-testid={`adapter-${a.type}`}>
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium">{a.label}</p>
                <Badge tone={STATUS_TONE[a.status]}>{STATUS_LABEL[a.status]}</Badge>
              </div>
              <p className="mt-1 text-xs text-muted">{a.note}</p>
            </li>
          ))}
          <li className="bg-surface p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="font-medium">Manual entry</p>
              <Badge tone="success">Available</Badge>
            </div>
            <p className="mt-1 text-xs text-muted"><Link href={`${base}/menu`} className="underline">Add dishes one by one</Link> in the menu editor.</p>
          </li>
        </ul>
      </Card>
      <Card>
        <CardHeader title="Your imports" />
        {jobs.length === 0 ? (
          <CardBody className="text-sm text-muted">No imports yet.</CardBody>
        ) : (
          <ul className="divide-y divide-line">
            {jobs.map((j) => (
              <li key={j.id}>
                <Link href={`${base}/import/${j.id}`} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 hover:bg-surface-2">
                  <span className="text-sm">
                    {j.createdAt.toISOString().slice(0, 16).replace('T', ' ')} UTC · {j.sources.map((s) => s.type).join(' + ') || 'no sources'} · {j._count.products} items
                  </span>
                  <Badge tone={JOB_TONE[j.status]}>{j.status.replace('_', ' ').toLowerCase()}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
