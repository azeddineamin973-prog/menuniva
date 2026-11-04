import { notFound } from 'next/navigation';
import { PrintButton } from '@/components/print-button';
import { formatCents } from '@/lib/money';
import { db } from '@/server/db';
import { UserFacingError } from '@/server/errors';
import { getSessionBill } from '@/server/services/bills';
import { requireTenantPage } from '@/server/tenant';
import { formatDateTimeInZone } from '@/lib/time';

/** Internal receipt (M8-09). Clearly labelled: it is NOT a legal invoice. */
export default async function ReceiptPage({ params }: { params: Promise<{ org: string; sessionId: string }> }) {
  const { org, sessionId } = await params;
  const ctx = await requireTenantPage(org, 'payments.record');
  let bill;
  try {
    bill = await getSessionBill(ctx, sessionId);
  } catch (e) {
    if (e instanceof UserFacingError) notFound();
    throw e;
  }
  const [orgRow, location] = await Promise.all([
    db.restaurantOrganization.findUniqueOrThrow({ where: { id: ctx.org.id }, select: { name: true, legalName: true, taxId: true } }),
    db.restaurantLocation.findUniqueOrThrow({ where: { id: bill.session.locationId } }),
  ]);
  return (
    <div>
      <div className="no-print mb-4"><PrintButton label="Print" /></div>
      <div className="mx-auto w-[80mm] bg-white p-3 font-mono text-sm text-black" data-testid="receipt">
        <p className="text-center font-bold">{orgRow.name}</p>
        {orgRow.legalName && <p className="text-center text-xs">{orgRow.legalName}</p>}
        {location.addressLine1 && <p className="text-center text-xs">{location.addressLine1}{location.city ? `, ${location.city}` : ''}</p>}
        {orgRow.taxId && <p className="text-center text-xs">NIF {orgRow.taxId}</p>}
        <p className="mt-2 border border-black p-1 text-center text-xs font-bold" data-testid="not-invoice">
          DOCUMENTO INTERNO — NÃO É FATURA
          <br />
          INTERNAL DOCUMENT — NOT AN INVOICE
        </p>
        <p className="mt-2 text-xs">Mesa {bill.session.table.label} · {formatDateTimeInZone(new Date(), location.timeZone)}</p>
        <hr className="my-2 border-dashed border-black" />
        {bill.items.map((i) => (
          <p key={i.id} className="flex justify-between gap-2">
            <span>{i.quantity} {i.nameSnapshot}</span>
            <span>{formatCents(i.lineTotalCents)}</span>
          </p>
        ))}
        <hr className="my-2 border-dashed border-black" />
        <p className="flex justify-between font-bold"><span>Total</span><span>{formatCents(bill.billedCents)}</span></p>
        <p className="flex justify-between"><span>Pago / Paid</span><span>{formatCents(bill.paidCents)}</span></p>
        <p className="flex justify-between"><span>Em falta / Due</span><span>{formatCents(bill.balanceCents)}</span></p>
        <p className="mt-2 text-center text-[10px]">Preços com IVA incluído. Peça a sua fatura ao restaurante.</p>
        <p className="mt-1 text-center text-[10px]" data-testid="not-certified">
          Registo operacional de pagamentos, sem validade fiscal: o MenuNiva não é software de faturação certificado nem POS certificado. / Operational payment record with no fiscal value: MenuNiva is not certified invoicing or POS software.
        </p>
      </div>
    </div>
  );
}
