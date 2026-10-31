import { ActionForm } from '@/components/forms/action-form';
import { Card, CardHeader, EmptyState, PageHeader, Select } from '@/components/ui';
import { db } from '@/server/db';
import { updateSupportTicketAction } from '../actions';
import { requirePlatformAdminPage } from '@/server/tenant';

export const dynamic = 'force-dynamic';

export default async function SupportPage() {
  // Layout checks are not re-run on client navigation, so every admin page checks itself.
  await requirePlatformAdminPage();
  const tickets = await db.supportTicket.findMany({ orderBy: { createdAt: 'desc' }, take: 100, include: { organization: { select: { name: true } } } });
  return (
    <>
      <PageHeader title="Support issues" description="Requests sent by restaurants from their dashboard." />
      {tickets.length === 0 ? (
        <EmptyState icon="help" title="No support issues" description="Requests restaurants send from their dashboard appear here." />
      ) : (
        <Card>
          <CardHeader icon="help" title={`${tickets.length} ${tickets.length === 1 ? 'issue' : 'issues'}`} />
          <ul className="divide-y divide-line">
            {tickets.map((t) => (
              <li key={t.id} className="grid gap-3 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start sm:px-5">
                <div className="min-w-0 flex-1">
                  <p className="font-medium break-words text-ink">{t.subject}</p>
                  <p className="text-xs text-muted">{t.organization?.name ?? 'No tenant'} · {t.createdAt.toISOString().slice(0, 16).replace('T', ' ')} UTC</p>
                  <p className="mt-1.5 text-sm break-words whitespace-pre-wrap text-ink-2">{t.body}</p>
                </div>
                <ActionForm action={updateSupportTicketAction} submitLabel="Update" submitVariant="secondary" className="flex flex-wrap items-center gap-2 space-y-0">
                  <input type="hidden" name="id" value={t.id} />
                  <Select name="status" defaultValue={t.status} aria-label="Status" className="w-40">
                    <option value="OPEN">Open</option>
                    <option value="IN_PROGRESS">In progress</option>
                    <option value="CLOSED">Closed</option>
                  </Select>
                </ActionForm>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
