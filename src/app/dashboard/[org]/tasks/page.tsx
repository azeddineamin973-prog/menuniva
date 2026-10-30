import { Alert, PageHeader } from '@/components/ui';
import { getMessages } from '@/i18n';
import { LANGUAGE_TAG } from '@/i18n/config';
import { requireTenantPage } from '@/server/tenant';
import { currentLocation } from '@/server/current-location';
import { LiveBoard } from '../orders/live-board';

/** Waiter view: table requests (call waiter / bill) on top of the live order board. */
export default async function TasksPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await requireTenantPage(org, 'tasks.manage');
  const location = await currentLocation(ctx);
  const m = getMessages(ctx.user.preferredLanguage);
  if (!location) return <Alert tone="warning">No location available.</Alert>;
  return (
    <>
      <PageHeader title={m.nav.tasks} description="Guests can call a waiter or ask for the bill from their table. Requests appear here and on Live Orders." />
      {ctx.can('orders.view') ? (
        <LiveBoard org={ctx.org.slug} locationId={location.id} canManage={ctx.can('orders.manage')} canTasks tag={LANGUAGE_TAG[ctx.user.preferredLanguage]} t={m.staff} />
      ) : (
        <Alert tone="info">Your role does not include the order board.</Alert>
      )}
    </>
  );
}
