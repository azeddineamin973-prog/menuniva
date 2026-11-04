import 'server-only';
import { z } from 'zod';
import { Prisma } from '@/generated/prisma/client';
import type { StationType } from '@/generated/prisma/enums';
import {
  ATTENTION_KINDS,
  LEVEL_RANK,
  MANAGER_ROLES,
  MAX_THRESHOLD_MINUTES,
  levelFor,
  ownerTiers,
  reservationLevel,
  resolveThresholds,
  responsibleRoles,
  ticketStartBy,
  visibleTo,
  type AttentionItem,
  type AttentionKind,
  type AttentionLevel,
  type AttentionNav,
  type AttentionSummary,
  type Thresholds,
} from '@/lib/attention';
import { audit } from '../audit';
import { db } from '../db';
import { orgModules } from '../modules';
import { assertLocationAccess, type TenantContext } from '../tenant';
import { openDelivery } from './fulfilment';

export type { AttentionItem, AttentionNav, AttentionSummary };

const MAX_ITEMS = 40;

/**
 * Everything still unresolved that this person is responsible for, or that has escalated to them,
 * derived from live business state on every call (audit OPS-01, D4): nothing is stored, so every
 * device and every page sees the same thing, and an item ends only when the order, ticket, request
 * or booking itself moves on. Scoped to the member's organization and locations.
 */
export async function attentionFor(ctx: TenantContext, now = new Date()): Promise<AttentionSummary> {
  const scope = ctx.locationIds.length ? { id: { in: ctx.locationIds } } : {};
  const [locations, members, modules] = await Promise.all([
    db.restaurantLocation.findMany({
      where: { organizationId: ctx.org.id, ...scope },
      select: { id: true, name: true, attentionThresholds: true, takeawaySettings: { select: { leadTimeMinutes: true } } },
      orderBy: { createdAt: 'asc' },
    }),
    db.restaurantMembership.findMany({ where: { organizationId: ctx.org.id, status: 'ACTIVE', user: { disabledAt: null } }, select: { role: true, locationIds: true } }),
    orgModules(ctx.org.id),
  ]);
  const summary: AttentionSummary = { serverTime: now.toISOString(), total: 0, levels: { waiting: 0, warning: 0, urgent: 0 }, byNav: {}, items: [] };
  if (!locations.length) return summary;
  const ids = locations.map((l) => l.id);
  const loc = new Map(locations.map((l) => [l.id, { name: l.name, thresholds: resolveThresholds(l.attentionThresholds), lead: l.takeawaySettings?.leadTimeMinutes ?? 20 }]));
  // Who works where: decides who owns each kind of work at each location (src/lib/attention.ts).
  const staffed = new Map(ids.map((id) => [id, new Set(members.filter((m) => m.locationIds.length === 0 || m.locationIds.includes(id)).map((m) => m.role))]));
  const isManager = MANAGER_ROLES.includes(ctx.role);
  const allowed: Record<AttentionKind, boolean> = {
    order_unaccepted: ctx.can('orders.view'),
    pickup_uncollected: ctx.can('orders.view'),
    delivery_no_driver: ctx.can('orders.view') || ctx.can('delivery.driver'),
    ticket_not_started: ctx.can('kds.view') && modules.has('kds'),
    ticket_overdue: ctx.can('kds.view') && modules.has('kds'),
    table_request: ctx.can('tasks.manage'),
    table_request_on_way: ctx.can('tasks.manage'),
    reservation_unconfirmed: ctx.can('reservations.manage') && modules.has('reservations'),
  };
  // Only read the kinds this person could ever be shown.
  const want = (k: AttentionKind) => allowed[k] && (isManager || [...ownerTiers(k, 'KITCHEN'), ...ownerTiers(k, 'CAFE')].some((tier) => tier.includes(ctx.role)));
  const where = { organizationId: ctx.org.id, locationId: { in: ids } };
  const [newOrders, pickups, deliveries, tickets, tasks, reservations] = await Promise.all([
    want('order_unaccepted') ? db.order.findMany({ where: { ...where, status: 'NEW' }, select: { id: true, number: true, locationId: true, createdAt: true } }) : [],
    want('pickup_uncollected') ? db.order.findMany({ where: { ...where, channel: 'TAKEAWAY', status: 'READY' }, select: { id: true, number: true, locationId: true, readyAt: true, pickupAt: true, updatedAt: true } }) : [],
    want('delivery_no_driver') ? db.order.findMany({ where: { ...where, channel: 'DELIVERY', status: 'READY', delivery: openDelivery }, select: { id: true, number: true, locationId: true, readyAt: true, updatedAt: true } }) : [],
    want('ticket_not_started')
      ? db.kitchenTicket.findMany({
          where: { organizationId: ctx.org.id, status: { in: ['PENDING', 'PREPARING'] }, station: { locationId: { in: ids } }, order: { status: { in: ['ACCEPTED', 'PREPARING', 'READY'] } } },
          select: { id: true, status: true, createdAt: true, startedAt: true, station: { select: { id: true, name: true, type: true, locationId: true } }, order: { select: { number: true, pickupAt: true } } },
        })
      : [],
    want('table_request') ? db.staffTask.findMany({ where: { ...where, status: { in: ['OPEN', 'ACKNOWLEDGED'] } }, select: { id: true, type: true, status: true, createdAt: true, acknowledgedAt: true, locationId: true, table: { select: { label: true } } } }) : [],
    want('reservation_unconfirmed') ? db.reservation.findMany({ where: { ...where, status: 'REQUESTED', startsAt: { gte: now } }, select: { id: true, name: true, partySize: true, startsAt: true, createdAt: true, locationId: true } }) : [],
  ]);

  const base = `/dashboard/${ctx.org.slug}`;
  const all: AttentionItem[] = [];
  const add = (kind: AttentionKind, entityId: string, locationId: string, since: Date, extra: Partial<AttentionItem>, opts: { stationType?: StationType; level?: AttentionLevel; nav: AttentionNav; href: string }) => {
    const l = loc.get(locationId);
    if (!l) return;
    const ageMs = Math.max(0, now.getTime() - since.getTime());
    const level = opts.level ?? levelFor(ageMs, l.thresholds[kind]);
    if (!visibleTo(ctx.role, kind, level, responsibleRoles(kind, opts.stationType, staffed.get(locationId)!))) return;
    all.push({ key: `${kind}:${entityId}`, kind, level, entityId, ageSec: Math.floor(ageMs / 1000), locationId, locationName: locations.length > 1 ? l.name : null, nav: opts.nav, href: opts.href, ...extra });
  };
  const orderLink = (id: string) => ({ nav: 'liveOrders' as const, href: `${base}/orders?focus=order-${id}` });

  for (const o of newOrders) add('order_unaccepted', o.id, o.locationId, o.createdAt, { orderNumber: o.number }, orderLink(o.id));
  for (const o of pickups) {
    // A scheduled pickup is not late before the time the guest chose.
    const ready = o.readyAt ?? o.updatedAt;
    add('pickup_uncollected', o.id, o.locationId, o.pickupAt && o.pickupAt > ready ? o.pickupAt : ready, { orderNumber: o.number }, orderLink(o.id));
  }
  for (const o of deliveries) {
    const driverView = ctx.can('delivery.driver');
    add('delivery_no_driver', o.id, o.locationId, o.readyAt ?? o.updatedAt, { orderNumber: o.number }, driverView ? { nav: 'myDeliveries', href: `${base}/driver#order-${o.id}` } : orderLink(o.id));
  }
  for (const t of tickets) {
    const l = loc.get(t.station.locationId);
    if (!l) continue;
    const link = { stationType: t.station.type, nav: 'kitchen' as const, href: `${base}/kitchen/${t.station.id}?focus=ticket-${t.id}` };
    const extra = { orderNumber: t.order.number, stationName: t.station.name };
    if (t.status === 'PENDING') add('ticket_not_started', t.id, t.station.locationId, ticketStartBy(t.createdAt, t.order.pickupAt, l.lead), extra, link);
    else add('ticket_overdue', t.id, t.station.locationId, t.startedAt ?? t.createdAt, extra, link);
  }
  for (const t of tasks) {
    const link = { nav: 'tasks' as const, href: `${base}/tasks?focus=task-${t.id}` };
    const extra = { tableLabel: t.table?.label ?? null, taskType: t.type };
    // "On my way" changes how it is shown, never whether it is open: it stays until Done.
    if (t.status === 'OPEN') add('table_request', t.id, t.locationId, t.createdAt, extra, link);
    else add('table_request_on_way', t.id, t.locationId, t.acknowledgedAt ?? t.createdAt, extra, link);
  }
  for (const r of reservations) {
    const l = loc.get(r.locationId)!;
    add('reservation_unconfirmed', r.id, r.locationId, r.createdAt, { guestName: r.name, partySize: r.partySize }, { level: reservationLevel(r.createdAt, r.startsAt, now, l.thresholds.reservation_unconfirmed), nav: 'reservations', href: `${base}/reservations#reservation-${r.id}` });
  }

  all.sort((a, b) => LEVEL_RANK[b.level] - LEVEL_RANK[a.level] || b.ageSec - a.ageSec);
  for (const i of all) {
    summary.levels[i.level] += 1;
    const n = summary.byNav[i.nav];
    summary.byNav[i.nav] = { count: (n?.count ?? 0) + 1, level: n && LEVEL_RANK[n.level] >= LEVEL_RANK[i.level] ? n.level : i.level };
  }
  summary.total = all.length;
  summary.items = all.slice(0, MAX_ITEMS);
  return summary;
}

// ------------------------------------------------------------------ settings (per location)

const minutes = z.coerce
  .number({ message: 'Enter a number of minutes.' })
  .int('Use whole minutes.')
  .min(1, 'At least 1 minute.')
  .max(MAX_THRESHOLD_MINUTES, `At most ${MAX_THRESHOLD_MINUTES} minutes (24 hours).`);
const thresholdSchema = z.object({ warn: minutes, urgent: minutes }).refine((t) => t.urgent > t.warn, { message: 'Urgent must be later than the warning.', path: ['urgent'] });
export const attentionSettingsSchema = z.object({
  locationId: z.string().min(1),
  ...(Object.fromEntries(ATTENTION_KINDS.map((k) => [k, thresholdSchema])) as Record<AttentionKind, typeof thresholdSchema>),
});

/** Form fields are named `<kind>.warn` and `<kind>.urgent` (so errors land on the right field). */
export function attentionInputFromForm(form: FormData) {
  return {
    locationId: form.get('locationId'),
    ...Object.fromEntries(ATTENTION_KINDS.map((k) => [k, { warn: form.get(`${k}.warn`), urgent: form.get(`${k}.urgent`) }])),
  };
}

export async function getAttentionThresholds(ctx: TenantContext, locationId: string): Promise<{ thresholds: Thresholds; custom: boolean }> {
  await assertLocationAccess(ctx, locationId);
  const l = await db.restaurantLocation.findUniqueOrThrow({ where: { id: locationId }, select: { attentionThresholds: true } });
  return { thresholds: resolveThresholds(l.attentionThresholds), custom: l.attentionThresholds !== null };
}

export async function updateAttentionThresholds(ctx: TenantContext, input: unknown) {
  const { locationId, ...thresholds } = attentionSettingsSchema.parse(input);
  await assertLocationAccess(ctx, locationId);
  const before = await db.restaurantLocation.findUniqueOrThrow({ where: { id: locationId }, select: { attentionThresholds: true } });
  await db.restaurantLocation.update({ where: { id: locationId }, data: { attentionThresholds: thresholds } });
  await audit({ organizationId: ctx.org.id, actorUserId: ctx.userId, action: 'location.attention_thresholds_updated', entityType: 'RestaurantLocation', entityId: locationId, metadata: { before: resolveThresholds(before.attentionThresholds), after: thresholds } });
}

/** Back to the recommended times (stored as "none"), so later improvements to them apply here too. */
export async function resetAttentionThresholds(ctx: TenantContext, locationId: unknown) {
  const id = z.string().min(1).parse(locationId);
  await assertLocationAccess(ctx, id);
  await db.restaurantLocation.update({ where: { id }, data: { attentionThresholds: Prisma.DbNull } });
  await audit({ organizationId: ctx.org.id, actorUserId: ctx.userId, action: 'location.attention_thresholds_reset', entityType: 'RestaurantLocation', entityId: id });
}
