import { ActionForm } from '@/components/forms/action-form';
import { Card, CardHeader, EmptyState, PageHeader, Select } from '@/components/ui';
import { db } from '@/server/db';
import { updateSupportTicketAction } from '../actions';

export const dynamic = 'force-dynamic';

export default async function SupportPage() {
  const tickets = await db.supportTicket.findMany({ orderBy: { createdAt: 'desc' }, take: 100, include: { organization: { select: { name: true } } } });
  return (
    <>
      <PageHeader title="Support issues" description="Requests sent by restaurants from their dashboard." />
      {tickets.length === 0 ? (
        <EmptyState title="No support issues" />
      ) : (
        <Card>
          <CardHeader title={`${tickets.length} issues`} />
          <ul className="divide-y divide-line">
            {tickets.map((t) => (
              <li key={t.id} className="flex flex-wrap items-start justify-between gap-4 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{t.subject}</p>
                  <p className="text-xs text-muted">{t.organization?.name ?? 'No tenant'} · {t.createdAt.toISOString().slice(0, 16).replace('T', ' ')} UTC</p>
                  <p className="mt-1 text-sm whitespace-pre-wrap">{t.body}</p>
                </div>
                <ActionForm action={updateSupportTicketAction} submitLabel="Update" submitVariant="secondary" className="flex items-end gap-2 space-y-0">
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
