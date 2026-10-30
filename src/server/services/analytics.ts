import 'server-only';
import type { OrderChannel } from '@/generated/prisma/enums';
import { zonedParts, zonedTimeToUtc } from '@/lib/time';
import { db } from '../db';
import { UserFacingError } from '../errors';
import { assertLocationAccess, type TenantContext } from '../tenant';
import { pickName } from './menu';

/**
 * Restaurant analytics (M12-01..04). Every figure comes from stored orders, payments,
 * reservations, feedback and upsell events — nothing is estimated or invented.
 * Days and hours are those of the location's time zone.
 *
 * Money is kept in separate buckets that must never be mixed:
 * - order value: what non-cancelled orders were worth (not money received);
 * - collected: payments actually recorded in the period (voided payments excluded);
 * - cancelled value: worth of cancelled orders;
 * - unpaid: what non-cancelled orders in the period still owe.
 */

export type RangePreset = 'today' | '7d' | '30d' | 'custom';
export type Range = { start: Date; end: Date; days: string[]; preset: RangePreset; from: string; to: string };

const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
function addDays(date: string, n: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const dayStart = (date: string, tz: string) => {
  const [y, m, d] = date.split('-').map(Number);
  return zonedTimeToUtc(y, m, d, 0, 0, tz);
};
export function localDate(at: Date, tz: string) {
  const p = zonedParts(at, tz);
  return iso(p.year, p.month, p.day);
}

/** Inclusive local-date range → [start, end) instants in the location time zone. */
export function resolveRange(tz: string, preset: string | undefined, from?: string, to?: string, now = new Date()): Range {
  const today = localDate(now, tz);
  let p: RangePreset = preset === '7d' || preset === '30d' || preset === 'custom' ? preset : 'today';
  let a = today;
  let b = today;
  if (p === '7d') a = addDays(today, -6);
  if (p === '30d') a = addDays(today, -29);
  if (p === 'custom') {
    const ok = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
    if (!ok(from) || !ok(to)) p = 'today';
    else {
      a = from! <= to! ? from! : to!;
      b = from! <= to! ? to! : from!;
      if ((Date.parse(b) - Date.parse(a)) / 86400_000 > 366) throw new UserFacingError('Choose a period of at most one year.');
    }
  }
  const days: string[] = [];
  for (let d = a; d <= b; d = addDays(d, 1)) days.push(d);
  return { start: dayStart(a, tz), end: dayStart(addDays(b, 1), tz), days, preset: p, from: a, to: b };
}

type Bucket = { count: number; valueCents: number };
const bucket = (): Bucket => ({ count: 0, valueCents: 0 });

export async function restaurantAnalytics(ctx: TenantContext, locationId: string, range: Pick<Range, 'start' | 'end' | 'days'>) {
  await assertLocationAccess(ctx, locationId);
  const location = await db.restaurantLocation.findFirst({ where: { id: locationId, organizationId: ctx.org.id } });
  if (!location) throw new UserFacingError('Location not found.', 404);
  const tz = location.timeZone;
  const inRange = { gte: range.start, lt: range.end };
  const scope = { organizationId: ctx.org.id, locationId };

  const [orders, payments, reservations, feedback, review, upsell, org] = await Promise.all([
    db.order.findMany({
      where: { ...scope, createdAt: inRange },
      select: { id: true, channel: true, status: true, totalCents: true, paidCents: true, discountCents: true, deliveryFeeCents: true, createdAt: true, delivery: { select: { zone: { select: { name: true } } } } },
    }),
    db.paymentRecord.findMany({ where: { organizationId: ctx.org.id, status: 'RECORDED', createdAt: inRange, order: { locationId } }, select: { amountCents: true, method: true } }),
    db.reservation.findMany({ where: { ...scope, startsAt: inRange }, select: { status: true, partySize: true } }),
    db.customerFeedback.findMany({ where: { ...scope, createdAt: inRange }, select: { rating: true, status: true } }),
    db.reviewSettings.findUnique({ where: { locationId } }),
    db.upsellEvent.groupBy({ by: ['eventType'], where: { organizationId: ctx.org.id, createdAt: inRange }, _count: { _all: true } }),
    db.restaurantOrganization.findUniqueOrThrow({ where: { id: ctx.org.id }, select: { sourceLanguage: true, defaultLanguage: true } }),
  ]);

  const live = orders.filter((o) => o.status !== 'CANCELLED');
  const cancelled = orders.filter((o) => o.status === 'CANCELLED');
  const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
  const orderValueCents = sum(live.map((o) => o.totalCents));
  const unpaidCents = sum(live.map((o) => Math.max(0, o.totalCents - o.paidCents)));
  const unpaidFinishedCents = sum(live.filter((o) => o.status === 'COMPLETED' || o.status === 'DELIVERED').map((o) => Math.max(0, o.totalCents - o.paidCents)));

  const byChannel: Partial<Record<OrderChannel, Bucket>> = {};
  const byHour = Array.from({ length: 24 }, bucket);
  const byDay = new Map(range.days.map((d) => [d, bucket()]));
  const byZone = new Map<string, Bucket>();
  for (const o of live) {
    (byChannel[o.channel] ??= bucket()).count++;
    byChannel[o.channel]!.valueCents += o.totalCents;
    const p = zonedParts(o.createdAt, tz);
    byHour[p.hour].count++;
    byHour[p.hour].valueCents += o.totalCents;
    const day = byDay.get(iso(p.year, p.month, p.day));
    if (day) {
      day.count++;
      day.valueCents += o.totalCents;
    }
    if (o.channel === 'DELIVERY') {
      const z = byZone.get(o.delivery?.zone?.name ?? '—') ?? bucket();
      z.count++;
      z.valueCents += o.totalCents;
      byZone.set(o.delivery?.zone?.name ?? '—', z);
    }
  }

  const liveIds = live.map((o) => o.id);
  const [items, discounts] = await Promise.all([
    liveIds.length
      ? db.orderItem.groupBy({ by: ['productId', 'nameSnapshot'], where: { orderId: { in: liveIds }, voidedAt: null }, _sum: { quantity: true, lineTotalCents: true } })
      : Promise.resolve([]),
    liveIds.length ? db.orderDiscount.groupBy({ by: ['description'], where: { orderId: { in: liveIds } }, _sum: { amountCents: true }, _count: { _all: true } }) : Promise.resolve([]),
  ]);
  const productIds = [...new Set(items.map((i) => i.productId).filter((x): x is string => !!x))];
  const products = productIds.length
    ? await db.menuProduct.findMany({ where: { id: { in: productIds }, organizationId: ctx.org.id }, select: { id: true, category: { select: { id: true, translations: true } } } })
    : [];
  const langs = [org.sourceLanguage, org.defaultLanguage];
  const categoryOf = new Map(products.map((p) => [p.id, { id: p.category.id, name: pickName(p.category.translations, langs) ?? '—' }]));
  const itemMap = new Map<string, { name: string; quantity: number; valueCents: number }>();
  const catMap = new Map<string, { name: string; quantity: number; valueCents: number }>();
  for (const i of items) {
    const key = i.productId ?? `name:${i.nameSnapshot}`;
    const cur = itemMap.get(key) ?? { name: i.nameSnapshot, quantity: 0, valueCents: 0 };
    cur.quantity += i._sum.quantity ?? 0;
    cur.valueCents += i._sum.lineTotalCents ?? 0;
    itemMap.set(key, cur);
    const cat = i.productId ? categoryOf.get(i.productId) : undefined;
    const ck = cat?.id ?? 'none';
    const c = catMap.get(ck) ?? { name: cat?.name ?? 'Removed dishes', quantity: 0, valueCents: 0 };
    c.quantity += i._sum.quantity ?? 0;
    c.valueCents += i._sum.lineTotalCents ?? 0;
    catMap.set(ck, c);
  }

  const threshold = review?.lowRatingThreshold ?? 3;
  const low = feedback.filter((f) => f.rating <= threshold);
  const shown = upsell.find((u) => u.eventType === 'SHOWN')?._count._all ?? 0;
  const accepted = upsell.find((u) => u.eventType === 'ACCEPTED')?._count._all ?? 0;

  return {
    timeZone: tz,
    money: {
      orderValueCents,
      collectedCents: sum(payments.map((p) => p.amountCents)),
      cancelledValueCents: sum(cancelled.map((o) => o.totalCents)),
      unpaidCents,
      unpaidFinishedCents,
      discountCents: sum(live.map((o) => o.discountCents)),
      deliveryFeesCents: sum(live.map((o) => o.deliveryFeeCents)),
      collectedByMethod: Object.entries(payments.reduce<Record<string, number>>((m, p) => ({ ...m, [p.method]: (m[p.method] ?? 0) + p.amountCents }), {})).sort((a, b) => b[1] - a[1]),
    },
    orders: {
      total: orders.length,
      completed: live.filter((o) => o.status === 'COMPLETED' || o.status === 'DELIVERED').length,
      cancelled: cancelled.length,
      averageCents: live.length ? Math.round(orderValueCents / live.length) : null,
      byChannel,
    },
    byDay: [...byDay.entries()].map(([date, b]) => ({ date, ...b })),
    byHour: byHour.map((b, hour) => ({ hour, ...b })),
    topItems: [...itemMap.values()].sort((a, b) => b.quantity - a.quantity || b.valueCents - a.valueCents).slice(0, 10),
    topCategories: [...catMap.values()].sort((a, b) => b.valueCents - a.valueCents).slice(0, 10),
    zones: [...byZone.entries()].map(([name, b]) => ({ name, ...b })).sort((a, b) => b.count - a.count),
    discounts: discounts.map((d) => ({ description: d.description, count: d._count._all, amountCents: d._sum.amountCents ?? 0 })).sort((a, b) => b.amountCents - a.amountCents),
    reservations: {
      total: reservations.length,
      byStatus: reservations.reduce<Record<string, number>>((m, r) => ({ ...m, [r.status]: (m[r.status] ?? 0) + 1 }), {}),
      covers: sum(reservations.filter((r) => ['CONFIRMED', 'ARRIVED', 'COMPLETED'].includes(r.status)).map((r) => r.partySize)),
    },
    feedback: {
      count: feedback.length,
      average: feedback.length ? Math.round((sum(feedback.map((f) => f.rating)) / feedback.length) * 10) / 10 : null,
      complaints: low.length,
      complaintsResolved: low.filter((f) => f.status === 'RESOLVED' || f.status === 'ARCHIVED').length,
    },
    upsell: { shown, accepted, acceptanceRate: shown ? Math.round((accepted / shown) * 1000) / 10 : null },
  };
}

// ------------------------------------------------------------------ CSV (M12-04)

/** Neutralises spreadsheet formulas and quotes a CSV cell (RFC 4180). */
export function csvCell(v: string | number | null | undefined): string {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const eur = (cents: number) => (cents / 100).toFixed(2);

/** One row per order in the period, with separate value / paid / unpaid columns. */
export async function ordersCsv(ctx: TenantContext, locationId: string, range: Pick<Range, 'start' | 'end'>) {
  await assertLocationAccess(ctx, locationId);
  const location = await db.restaurantLocation.findFirstOrThrow({ where: { id: locationId, organizationId: ctx.org.id } });
  const orders = await db.order.findMany({
    where: { organizationId: ctx.org.id, locationId, createdAt: { gte: range.start, lt: range.end } },
    orderBy: { createdAt: 'asc' },
    select: { number: true, createdAt: true, channel: true, status: true, paymentStatus: true, subtotalCents: true, discountCents: true, deliveryFeeCents: true, totalCents: true, paidCents: true, table: { select: { label: true } } },
    take: 50_000,
  });
  const header = ['order_number', `local_date (${location.timeZone})`, 'local_time', 'channel', 'table', 'status', 'payment_status', 'subtotal_eur', 'discount_eur', 'delivery_fee_eur', 'order_value_eur', 'paid_eur', 'unpaid_eur'];
  const rows = orders.map((o) => {
    const p = zonedParts(o.createdAt, location.timeZone);
    const cancelled = o.status === 'CANCELLED';
    return [
      o.number,
      iso(p.year, p.month, p.day),
      `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`,
      o.channel,
      o.table?.label ?? '',
      o.status,
      o.paymentStatus,
      eur(o.subtotalCents),
      eur(o.discountCents),
      eur(o.deliveryFeeCents),
      eur(o.totalCents),
      eur(o.paidCents),
      eur(cancelled ? 0 : Math.max(0, o.totalCents - o.paidCents)),
    ];
  });
  return `\uFEFF${[header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
}
