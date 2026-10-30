import { Alert, PageHeader } from '@/components/ui';
import { getMessages } from '@/i18n';
import { LANGUAGE_TAG } from '@/i18n/config';
import { requireTenantPage } from '@/server/tenant';
import { currentLocation } from '@/server/current-location';
import { LiveBoard } from './live-board';

export default async function LiveOrdersPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await requireTenantPage(org, 'orders.view');
  const location = await currentLocation(ctx);
  const m = getMessages(ctx.user.preferredLanguage);
  if (!location) return <Alert tone="warning">No location available.</Alert>;
  return (
    <>
      <PageHeader title={m.nav.liveOrders} description={`${location.name} · New orders stay highlighted until someone marks them as seen or accepts them.`} />
      <LiveBoard org={ctx.org.slug} locationId={location.id} canManage={ctx.can('orders.manage')} canTasks={ctx.can('tasks.manage')} tag={LANGUAGE_TAG[ctx.user.preferredLanguage]} t={m.staff} />
    </>
  );
}
