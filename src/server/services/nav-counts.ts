import 'server-only';
import { db } from '../db';
import { orgModules } from '../modules';
import type { TenantContext } from '../tenant';
import { attentionFor, type AttentionSummary } from './attention';

/** Items waiting for staff, shown as sidebar badges. Keys match NAV_ITEMS keys. */
export type NavCounts = { liveOrders: number; tasks: number; bills: number; reservations: number; reviews: number };

/**
 * Counts across every location the member can access (same scope as the sidebar). Each count is
 * only computed when the member may open that section, so the numbers never leak other areas.
 */
export async function navCounts(ctx: TenantContext): Promise<NavCounts> {
  const modules = await orgModules(ctx.org.id);
  const where = { organizationId: ctx.org.id, ...(ctx.locationIds.length ? { locationId: { in: ctx.locationIds } } : {}) };
  // A table request is open until someone marks it done: "On my way" never takes it off the
  // badge (audit OPS-13), it only shows that someone is going.
  const unresolvedTask = { status: { in: ['OPEN' as const, 'ACKNOWLEDGED' as const] } };
  const [liveOrders, tasks, bills, reservations, reviews] = await Promise.all([
    // Every order still waiting to be accepted or rejected, on every device (audit OPS-02: a
    // "seen" mark used to take it out of everyone's count while nobody had accepted it).
    ctx.can('orders.view') ? db.order.count({ where: { ...where, status: 'NEW' } }) : 0,
    ctx.can('tasks.manage') ? db.staffTask.count({ where: { ...where, ...unresolvedTask } }) : 0,
    // Guests asking for the bill from their table.
    ctx.can('payments.record') ? db.staffTask.count({ where: { ...where, type: 'REQUEST_BILL', ...unresolvedTask } }) : 0,
    // Booking requests still waiting for a confirm / reject, for times that have not passed yet.
    ctx.can('reservations.manage') && modules.has('reservations') ? db.reservation.count({ where: { ...where, status: 'REQUESTED', startsAt: { gte: new Date() } } }) : 0,
    ctx.can('reviews.view') ? db.notification.count({ where: { ...where, type: 'LOW_RATING', readAt: null } }) : 0,
  ]);
  return { liveOrders, tasks, bills, reservations, reviews };
}

/**
 * What the dashboard frame shows on every page, polled by the shell: the sidebar counts plus the
 * shared attention summary (src/server/services/attention.ts). Kitchen and My deliveries badges
 * count the attention items of those sections (late tickets, deliveries waiting for a driver).
 */
export type NavStatus = NavCounts & { kitchen: number; myDeliveries: number; attention: AttentionSummary };
export async function navStatus(ctx: TenantContext, now = new Date()): Promise<NavStatus> {
  const [counts, attention] = await Promise.all([navCounts(ctx), attentionFor(ctx, now)]);
  return { ...counts, kitchen: attention.byNav.kitchen?.count ?? 0, myDeliveries: attention.byNav.myDeliveries?.count ?? 0, attention };
}
