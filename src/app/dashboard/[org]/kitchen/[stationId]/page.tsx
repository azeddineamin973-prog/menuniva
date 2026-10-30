import { notFound } from 'next/navigation';
import { db } from '@/server/db';
import { assertLocationAccess, requireTenantPage } from '@/server/tenant';
import { KdsBoard } from './kds-board';

export default async function StationDisplayPage({ params }: { params: Promise<{ org: string; stationId: string }> }) {
  const { org, stationId } = await params;
  const ctx = await requireTenantPage(org, 'kds.view');
  const station = await db.kitchenStation.findFirst({ where: { id: stationId, organizationId: ctx.org.id } });
  if (!station) notFound();
  try {
    await assertLocationAccess(ctx, station.locationId);
  } catch {
    notFound();
  }
  return (
    <div className="-mx-4 -my-6 sm:-mx-6 lg:-mx-8 lg:-my-8">
      <KdsBoard org={ctx.org.slug} stationId={station.id} canUpdate={ctx.can('kds.update')} />
    </div>
  );
}
