import { notFound } from 'next/navigation';
import { db } from '@/server/db';
import { requireModulePage } from '@/server/module-page';
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
    <div className="-mx-4 -mt-5 -mb-24 sm:-mx-6 lg:-mx-8 lg:-mt-7 lg:-mb-10">
      <KdsBoard org={ctx.org.slug} stationId={station.id} stationName={station.name} canUpdate={ctx.can('kds.update')} t={getMessages(ctx.user.preferredLanguage).staff} />
    </div>
  );
}
