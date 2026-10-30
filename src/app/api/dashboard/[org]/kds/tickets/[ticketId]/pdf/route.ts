import { handleRouteError } from '@/server/http';
import { ticketPdf } from '@/server/printing';
import { ticketPrintData } from '@/server/services/tickets';
import { requireTenantAction } from '@/server/tenant';

// 80 mm kitchen/café ticket as PDF (print from the tablet to any printer).
export async function GET(_req: Request, { params }: { params: Promise<{ org: string; ticketId: string }> }) {
  try {
    const { org, ticketId } = await params;
    const ctx = await requireTenantAction(org, 'kds.view');
    const data = await ticketPrintData(ctx, ticketId);
    return new Response(new Uint8Array(await ticketPdf(data)), {
      headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="ticket-${data.orderNumber}-${data.station.replace(/[^A-Za-z0-9]/g, '_')}.pdf"`, 'Cache-Control': 'private, no-store' },
    });
  } catch (e) {
    return handleRouteError('ticket-pdf', e);
  }
}
