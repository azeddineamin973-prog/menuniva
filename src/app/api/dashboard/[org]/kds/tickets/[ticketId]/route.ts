import { tenantRoute } from '@/server/route-tenant';
import { changeTicketStatus } from '@/server/services/orders';

export async function POST(req: Request, { params }: { params: Promise<{ org: string; ticketId: string }> }) {
  const { org, ticketId } = await params;
  const body = await req.json().catch(() => ({}));
  return tenantRoute(req, org, 'kds.update', (ctx) => changeTicketStatus(ctx, { ...body, ticketId }), 'kds-ticket');
}
