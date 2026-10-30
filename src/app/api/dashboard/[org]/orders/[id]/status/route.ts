import { tenantRoute } from '@/server/route-tenant';
import { acknowledgeOrder, changeOrderStatus, setOrderPriority } from '@/server/services/orders';

export async function POST(req: Request, { params }: { params: Promise<{ org: string; id: string }> }) {
  const { org, id } = await params;
  const body = await req.json().catch(() => ({}));
  if (body?.action === 'priority') return tenantRoute(req, org, 'orders.manage', (ctx) => setOrderPriority(ctx, id, body.isPriority === true), 'order-priority');
  if (body?.action === 'acknowledge') return tenantRoute(req, org, 'orders.view', (ctx) => acknowledgeOrder(ctx, id), 'order-ack');
  return tenantRoute(req, org, 'orders.manage', (ctx) => changeOrderStatus(ctx, { ...body, orderId: id }), 'order-status');
}
