import { Card, CardHeader, EmptyState, PageHeader } from '@/components/ui';
import { Table, TableWrap, TD, TH, THead, TR } from '@/components/ui/table';
import { db } from '@/server/db';
import { requirePlatformAdminPage } from '@/server/tenant';

export const dynamic = 'force-dynamic';

export default async function AuditPage() {
  // Layout checks are not re-run on client navigation, so every admin page checks itself.
  await requirePlatformAdminPage();
  const logs = await db.auditLog.findMany({
    where: { action: { startsWith: 'platform.' } },
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: { actor: { select: { email: true } }, organization: { select: { name: true } } },
  });
  return (
    <>
      <PageHeader title="Platform audit log" description="Every Super Admin action is recorded here." />
      {logs.length === 0 ? (
        <EmptyState icon="book" title="No platform actions yet" description="Changes made by Super Admins (tenants, plans, settings) are listed here." />
      ) : (
        <Card className="overflow-hidden">
          <CardHeader icon="book" title="Recent platform actions" description={`${logs.length} most recent`} />
          <TableWrap>
            <Table>
              <THead>
                <tr>
                  <TH>When (UTC)</TH>
                  <TH>Action</TH>
                  <TH className="hidden sm:table-cell">Actor</TH>
                  <TH className="hidden md:table-cell">Tenant</TH>
                </tr>
              </THead>
              <tbody>
                {logs.map((l) => (
                  <TR key={l.id}>
                    <TD className="whitespace-nowrap tabular-nums">{l.createdAt.toISOString().slice(0, 16).replace('T', ' ')}</TD>
                    <TD>
                      <span className="font-mono text-xs break-all">{l.action}</span>
                      <span className="block text-xs text-muted sm:hidden">{l.actor?.email ?? 'system'}</span>
                    </TD>
                    <TD className="hidden sm:table-cell">{l.actor?.email ?? 'system'}</TD>
                    <TD className="hidden md:table-cell">{l.organization?.name ?? '—'}</TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        </Card>
      )}
    </>
  );
}
