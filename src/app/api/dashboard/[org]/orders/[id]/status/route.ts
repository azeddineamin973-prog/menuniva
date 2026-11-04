import { tenantRoute } from '@/server/route-tenant';
import { assertStaffMayMoveDelivery } from '@/server/services/fulfilment';
import { UserFacingError } from '@/server/errors';
import { changeOrderStatus, setOrderPriority } from '@/server/services/orders';

export async function POST(req: Request, { params }: { params: Promise<{ org: string; id: string }> }) {
  const { org, id } = await params;
  const body = await req.json().catch(() => ({}));
  if (body?.action === 'priority') return tenantRoute(req, org, 'orders.manage', (ctx) => setOrderPriority(ctx, id, body.isPriority === true), 'order-priority');
  // "Seen" took a still-unaccepted order out of every device's alerts (audit OPS-02). It is gone:
  // an order waits until someone accepts or rejects it. A tab still running the old page gets told.
  if (body?.action === 'acknowledge')
    return tenantRoute(
      req,
      org,
      'orders.view',
      () => {
        throw new UserFacingError('“Seen” no longer exists: accept or reject the order. It stays on every screen until then.', 410);
      },
      'order-ack',
    );
  return tenantRoute(
    req,
    org,
    'orders.manage',
    async (ctx) => {
      // Drivers confirm pickup and delivery themselves (driver screen), not staff.
      await assertStaffMayMoveDelivery(ctx, id, body?.to);
      return changeOrderStatus(ctx, { ...body, orderId: id });
    },
    'order-status',
  );
}
