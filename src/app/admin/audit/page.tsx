import { Card, CardHeader, PageHeader } from '@/components/ui';
import { db } from '@/server/db';

export const dynamic = 'force-dynamic';

export default async function AuditPage() {
  const logs = await db.auditLog.findMany({
    where: { action: { startsWith: 'platform.' } },
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: { actor: { select: { email: true } }, organization: { select: { name: true } } },
  });
  return (
    <>
      <PageHeader title="Platform audit log" description="Every Super Admin action is recorded here." />
      <Card className="overflow-x-auto">
        <CardHeader title={`${logs.length} most recent platform actions`} />
        <table className="w-full text-sm">
          <thead className="text-xs text-muted uppercase">
            <tr>
              <th className="px-4 py-2 text-start">When (UTC)</th>
              <th className="px-4 py-2 text-start">Action</th>
              <th className="px-4 py-2 text-start">Actor</th>
              <th className="px-4 py-2 text-start">Tenant</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.id} className="border-t border-line">
                <td className="px-4 py-2 whitespace-nowrap">{l.createdAt.toISOString().slice(0, 19).replace('T', ' ')}</td>
                <td className="px-4 py-2 font-mono text-xs">{l.action}</td>
                <td className="px-4 py-2">{l.actor?.email ?? 'system'}</td>
                <td className="px-4 py-2">{l.organization?.name ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
