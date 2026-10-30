import 'server-only';
import { db } from '../db';
import { UserFacingError } from '../errors';
import type { TicketData } from '../printing';
import { assertLocationAccess, type TenantContext } from '../tenant';

/** Data for one station's printable ticket (kitchen and café print separately). */
export async function ticketPrintData(ctx: TenantContext, ticketId: string, markPrinted = true): Promise<TicketData> {
  const t = await db.kitchenTicket.findFirst({
    where: { id: ticketId, organizationId: ctx.org.id },
    include: {
      station: { include: { location: { select: { timeZone: true } } } },
      order: {
        include: {
          table: { select: { label: true } },
          items: { where: { voidedAt: null }, include: { modifiers: true }, orderBy: { createdAt: 'asc' } },
        },
      },
    },
  });
  if (!t) throw new UserFacingError('Ticket not found.', 404);
  await assertLocationAccess(ctx, t.station.locationId);
  if (markPrinted) await db.kitchenTicket.update({ where: { id: t.id }, data: { printedAt: new Date() } });
  const o = t.order;
  return {
    restaurant: ctx.org.name,
    station: t.station.name,
    orderNumber: o.number,
    where: o.channel === 'TABLE' ? `Mesa ${o.table?.label ?? '?'}` : o.channel === 'TAKEAWAY' ? `Take-away ${o.customerName ?? ''}`.trim() : 'Entrega',
    createdAt: o.acceptedAt ?? o.createdAt,
    timeZone: t.station.location.timeZone,
    items: o.items
      .filter((i) => i.stationId === t.stationId)
      .map((i) => ({ quantity: i.quantity, name: i.nameSnapshot, detail: [i.variantNameSnapshot, ...i.modifiers.map((m) => `${m.quantity > 1 ? `${m.quantity}x ` : ''}${m.nameSnapshot}`)].filter(Boolean).join(', ') || null, notes: i.notes })),
    orderNotes: o.customerNotes,
  };
}
