import Link from 'next/link';
import { Alert, Badge, Card, EmptyState, PageHeader } from '@/components/ui';
import { getMessages } from '@/i18n';
import { formatCents } from '@/lib/money';
import { currentLocation } from '@/server/current-location';
import { listOpenSessions } from '@/server/services/bills';
import { requireTenantPage } from '@/server/tenant';

export default async function BillsPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await requireTenantPage(org, 'payments.record');
  const location = await currentLocation(ctx);
  if (!location) return <Alert tone="warning">No location.</Alert>;
  const sessions = await listOpenSessions(ctx, location.id);
  const m = getMessages(ctx.user.preferredLanguage);
  return (
    <>
      <PageHeader title={m.nav.bills} description="Open tables with all their orders on one bill. Payments are taken at the restaurant and recorded here; MenuNiva does not issue legal invoices." />
      {sessions.length === 0 ? (
        <EmptyState title="No open tables" description="A table opens automatically with its first order." />
      ) : (
        <Card>
          <ul className="divide-y divide-line">
            {sessions.map((s) => (
              <li key={s.id}>
                <Link href={`/dashboard/${ctx.org.slug}/bills/${s.id}`} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 hover:bg-surface-2" data-testid="open-session">
                  <span className="font-semibold">Table {s.table.label}</span>
                  <span className="flex flex-wrap items-center gap-2 text-sm">
                    {s.activeOrders > 0 && <Badge tone="info">{s.activeOrders} in progress</Badge>}
                    <span className="tabular-nums">{formatCents(s.billedCents)}</span>
                    <Badge tone={s.paidCents >= s.billedCents && s.billedCents > 0 ? 'success' : s.paidCents > 0 ? 'warning' : 'neutral'}>
                      {s.paidCents >= s.billedCents && s.billedCents > 0 ? 'Paid' : s.paidCents > 0 ? `Paid ${formatCents(s.paidCents)}` : 'Not paid'}
                    </Badge>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
