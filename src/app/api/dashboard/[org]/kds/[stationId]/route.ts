import { tenantRoute } from '@/server/route-tenant';
import { stationTickets } from '@/server/services/orders';

export async function GET(req: Request, { params }: { params: Promise<{ org: string; stationId: string }> }) {
  const { org, stationId } = await params;
  return tenantRoute(req, org, 'kds.view', async (ctx) => ({ serverTime: new Date().toISOString(), ...(await stationTickets(ctx, stationId)) }), 'kds-poll');
}
