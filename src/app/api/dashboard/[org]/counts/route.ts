import { tenantRoute } from '@/server/route-tenant';
import { navStatus } from '@/server/services/nav-counts';

// Polled by the dashboard shell so sidebar badges and the attention summary stay current on every page.
export async function GET(req: Request, { params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  return tenantRoute(req, org, undefined, (ctx) => navStatus(ctx), 'dashboard-nav-counts');
}
