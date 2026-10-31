import { handleRouteError } from '@/server/http';
import { currentLocation } from '@/server/current-location';
import { db } from '@/server/db';
import { getRestaurantLink } from '@/server/services/restaurant-link';
import { qrPng, qrSvg } from '@/server/services/tables';
import { requireTenantAction } from '@/server/tenant';

/**
 * QR code for the restaurant's public menu link (staff only). It encodes the public address
 * (APP_BASE_URL/r/<restaurant>), which shows the menu only once the location is published —
 * scanning it earlier shows a "not published yet" notice, never the draft.
 */
export async function GET(req: Request, { params }: { params: Promise<{ org: string }> }) {
  try {
    const { org } = await params;
    const ctx = await requireTenantAction(org, 'menu.view');
    const sp = new URL(req.url).searchParams;
    const requested = sp.get('location');
    const location = requested ? await db.restaurantLocation.findFirst({ where: { id: requested, organizationId: ctx.org.id }, select: { id: true } }) : await currentLocation(ctx);
    if (!location) return new Response('Not found', { status: 404 });
    const link = await getRestaurantLink(ctx, location.id, { checks: false });
    const format = sp.get('format') === 'svg' ? 'svg' : 'png';
    // A QR for a development address is marked in its file name so it is never mistaken for the real one.
    const filename = `${ctx.org.slug}${link.path.split('/').length > 3 ? `-${link.location.slug}` : ''}-menu-qr${link.local ? '-local-test' : ''}.${format}`;
    const headers: Record<string, string> = { 'Cache-Control': 'private, no-store', 'X-Restaurant-Url': link.url, 'X-Restaurant-Url-Public': link.local ? 'no' : 'yes' };
    if (format === 'png' || sp.get('download') === '1') headers['Content-Disposition'] = `attachment; filename="${filename.replace(/[^A-Za-z0-9._-]/g, '_')}"`;
    if (format === 'png') return new Response(new Uint8Array(await qrPng(link.url)), { headers: { ...headers, 'Content-Type': 'image/png' } });
    return new Response(await qrSvg(link.url), { headers: { ...headers, 'Content-Type': 'image/svg+xml' } });
  } catch (e) {
    return handleRouteError('qr', e);
  }
}
