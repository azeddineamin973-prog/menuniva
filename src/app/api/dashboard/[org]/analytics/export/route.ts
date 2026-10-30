import { currentLocation } from '@/server/current-location';
import { handleRouteError } from '@/server/http';
import { assertModule } from '@/server/modules';
import { ordersCsv, resolveRange } from '@/server/services/analytics';
import { requireTenantAction } from '@/server/tenant';

// CSV export of the orders behind the analytics page (same period and location).
export async function GET(req: Request, { params }: { params: Promise<{ org: string }> }) {
  try {
    const { org } = await params;
    const ctx = await requireTenantAction(org, 'analytics.view');
    await assertModule(ctx.org.id, 'analytics_export');
    const location = await currentLocation(ctx);
    if (!location) return new Response('No location', { status: 404 });
    const sp = new URL(req.url).searchParams;
    const range = resolveRange(location.timeZone, sp.get('p') ?? undefined, sp.get('from') ?? undefined, sp.get('to') ?? undefined);
    const csv = await ordersCsv(ctx, location.id, range);
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="menuniva-orders-${ctx.org.slug}-${range.from}_${range.to}.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    return handleRouteError('analytics-export', e);
  }
}
