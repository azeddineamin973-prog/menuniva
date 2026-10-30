import { notFound } from 'next/navigation';
import { db } from '@/server/db';
import { requireModulePage } from '@/server/modules';
import { assertLocationAccess, requireTenantPage } from '@/server/tenant';
import { KdsBoard } from './kds-board';
import { getMessages } from '@/i18n';

export default async function StationDisplayPage({ params }: { params: Promise<{ org: string; stationId: string }> }) {
  const { org, stationId } = await params;
  const ctx = await requireTenantPage(org, 'kds.view');
  await requireModulePage(ctx, 'kds');
  const station = await db.kitchenStation.findFirst({ where: { id: stationId, organizationId: ctx.org.id } });
  if (!station) notFound();
  try {
    await assertLocationAccess(ctx, station.locationId);
  } catch {
    notFound();
  }
  return (
    <div className="-mx-4 -my-6 sm:-mx-6 lg:-mx-8 lg:-my-8">
      <KdsBoard org={ctx.org.slug} stationId={station.id} canUpdate={ctx.can('kds.update')} t={getMessages(ctx.user.preferredLanguage).staff} />
    </div>
  );
}
