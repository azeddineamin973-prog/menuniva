import { startOfDayInZone } from '@/lib/time';
import { db } from '@/server/db';
import { UserFacingError } from '@/server/errors';
import { tenantRoute } from '@/server/route-tenant';
import { liveOrders } from '@/server/services/orders';
import { listOpenTasks } from '@/server/services/staff-tasks';

// Polled every few seconds by the Live Orders dashboard. Returns authoritative DB state.
export async function GET(req: Request, { params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  return tenantRoute(
    req,
    org,
    'orders.view',
    async (ctx) => {
      const locationId = new URL(req.url).searchParams.get('location') ?? '';
      const location = await db.restaurantLocation.findFirst({ where: { id: locationId, organizationId: ctx.org.id } });
      if (!location) throw new UserFacingError('Location not found.', 404);
      const [orders, tasks] = await Promise.all([
        liveOrders(ctx, location.id, startOfDayInZone(new Date(), location.timeZone)),
        ctx.can('tasks.manage') ? listOpenTasks(ctx, location.id) : Promise.resolve([]),
      ]);
      return { serverTime: new Date().toISOString(), orders, tasks };
    },
    'dashboard-live-orders',
  );
}
