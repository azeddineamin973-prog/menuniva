import { notFound } from 'next/navigation';
import { PrintButton } from '@/components/print-button';
import { UserFacingError } from '@/server/errors';
import { ticketPrintData } from '@/server/services/tickets';
import { requireTenantPage } from '@/server/tenant';
import { formatTimeInZone } from '@/lib/time';

/** Printable 80 mm ticket for one station (HTML print; works with any printer the tablet can use). */
export default async function TicketPrintPage({ params }: { params: Promise<{ org: string; ticketId: string }> }) {
  const { org, ticketId } = await params;
  const ctx = await requireTenantPage(org, 'kds.view');
  let t;
  try {
    t = await ticketPrintData(ctx, ticketId);
  } catch (e) {
    if (e instanceof UserFacingError) notFound();
    throw e;
  }
  return (
    <div>
      <div className="no-print mb-4"><PrintButton label="Print ticket" /></div>
      <div className="mx-auto w-[80mm] bg-white p-3 font-mono text-black" data-testid="ticket">
        <p className="text-center text-3xl font-bold">#{t.orderNumber}</p>
        <p className="text-center text-lg font-bold">{t.where}</p>
        <p className="text-center text-sm">{t.station} · {formatTimeInZone(t.createdAt, t.timeZone)}</p>
        <hr className="my-2 border-dashed border-black" />
        <ul className="space-y-1">
          {t.items.map((i, k) => (
            <li key={k}>
              <p className="font-bold">{i.quantity} × {i.name}</p>
              {i.detail && <p className="ps-4 text-sm">{i.detail}</p>}
              {i.notes && <p className="ps-4 text-sm font-bold">! {i.notes}</p>}
            </li>
          ))}
        </ul>
        {t.orderNotes && (
          <>
            <hr className="my-2 border-dashed border-black" />
            <p className="text-sm font-bold">Nota: {t.orderNotes}</p>
          </>
        )}
      </div>
    </div>
  );
}
