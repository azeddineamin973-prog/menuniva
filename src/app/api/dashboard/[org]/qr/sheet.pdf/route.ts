import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { handleRouteError } from '@/server/http';
import { db } from '@/server/db';
import { qrPng, tableQrUrl } from '@/server/services/tables';
import { assertLocationAccess, requireTenantAction } from '@/server/tenant';

// Printable A4 PDF with one card per table (6 per page): restaurant name, table label, QR code.
export async function GET(req: Request, { params }: { params: Promise<{ org: string }> }) {
  try {
    const { org } = await params;
    const ctx = await requireTenantAction(org, 'tables.view');
    const locationId = new URL(req.url).searchParams.get('location') ?? '';
    await assertLocationAccess(ctx, locationId);
    const tables = await db.restaurantTable.findMany({
      where: { locationId, organizationId: ctx.org.id, isActive: true },
      orderBy: [{ area: { sortOrder: 'asc' } }, { sortOrder: 'asc' }],
      include: { area: true, qrTokens: { where: { isActive: true }, take: 1 } },
    });
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const [W, H] = [595.28, 841.89];
    const cols = 2;
    const rows = 3;
    const cw = W / cols;
    const ch = H / rows;
    let page = pdf.addPage([W, H]);
    let i = 0;
    const safe = (s: string) => s.replace(/[^\x20-\x7E\u00A0-\u00FF]/g, '?');
    for (const t of tables) {
      const token = t.qrTokens[0]?.token;
      if (!token) continue;
      if (i > 0 && i % (cols * rows) === 0) page = pdf.addPage([W, H]);
      const slot = i % (cols * rows);
      const x = (slot % cols) * cw;
      const y = H - (Math.floor(slot / cols) + 1) * ch;
      page.drawRectangle({ x: x + 14, y: y + 14, width: cw - 28, height: ch - 28, borderColor: rgb(0.85, 0.86, 0.84), borderWidth: 1 });
      const png = await pdf.embedPng(await qrPng(tableQrUrl(token), 600));
      const size = 150;
      page.drawImage(png, { x: x + (cw - size) / 2, y: y + 70, width: size, height: size });
      const name = safe(ctx.org.name);
      page.drawText(name, { x: x + (cw - bold.widthOfTextAtSize(name, 13)) / 2, y: y + ch - 52, size: 13, font: bold, color: rgb(0.09, 0.1, 0.11) });
      const label = safe(`Mesa / Table ${t.label}`);
      page.drawText(label, { x: x + (cw - bold.widthOfTextAtSize(label, 20)) / 2, y: y + ch - 80, size: 20, font: bold });
      const hint = 'Digitalize para ver o menu e pedir · Scan to order';
      page.drawText(hint, { x: x + (cw - font.widthOfTextAtSize(hint, 9)) / 2, y: y + 50, size: 9, font, color: rgb(0.38, 0.4, 0.43) });
      if (t.area) {
        const a = safe(t.area.name);
        page.drawText(a, { x: x + (cw - font.widthOfTextAtSize(a, 9)) / 2, y: y + 36, size: 9, font, color: rgb(0.38, 0.4, 0.43) });
      }
      i++;
    }
    if (i === 0) page.drawText('No active tables.', { x: 50, y: H - 80, size: 14, font });
    const bytes = await pdf.save();
    return new Response(new Uint8Array(bytes), {
      headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${ctx.org.slug}-table-qr-codes.pdf"`, 'Cache-Control': 'private, no-store' },
    });
  } catch (e) {
    return handleRouteError('qr-pdf', e);
  }
}
