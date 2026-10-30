import { handleRouteError } from '@/server/http';
import { db } from '@/server/db';
import { activeQrToken, qrPng, qrSvg, tableQrUrl } from '@/server/services/tables';
import { assertLocationAccess, requireTenantAction } from '@/server/tenant';

// QR code image for one table (staff only). The QR encodes /t/<random token>, never a DB id.
export async function GET(req: Request, { params }: { params: Promise<{ org: string; tableId: string }> }) {
  try {
    const { org, tableId } = await params;
    const ctx = await requireTenantAction(org, 'tables.view');
    const table = await db.restaurantTable.findFirst({ where: { id: tableId, organizationId: ctx.org.id } });
    if (!table) return new Response('Not found', { status: 404 });
    await assertLocationAccess(ctx, table.locationId);
    const token = await activeQrToken(table.id);
    if (!token) return new Response('No active QR code', { status: 404 });
    const url = tableQrUrl(token.token);
    const format = new URL(req.url).searchParams.get('format') === 'png' ? 'png' : 'svg';
    const download = new URL(req.url).searchParams.get('download') === '1' || format === 'png';
    const filename = `${ctx.org.slug}-table-${table.label.replace(/[^A-Za-z0-9_-]/g, '_')}.${format}`;
    const headers: Record<string, string> = { 'Cache-Control': 'private, no-store' };
    if (download) headers['Content-Disposition'] = `attachment; filename="${filename}"`;
    if (format === 'png') return new Response(new Uint8Array(await qrPng(url)), { headers: { ...headers, 'Content-Type': 'image/png' } });
    return new Response(await qrSvg(url), { headers: { ...headers, 'Content-Type': 'image/svg+xml' } });
  } catch (e) {
    return handleRouteError('qr', e);
  }
}
