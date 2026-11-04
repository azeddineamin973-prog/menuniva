import { describe, expect, it } from 'vitest';
import type { MembershipRole } from '@/generated/prisma/enums';
import {
  ACT_NOW,
  ATTENTION_KINDS,
  attentionText,
  DEFAULT_THRESHOLDS,
  isValidThreshold,
  levelFor,
  reservationLevel,
  resolveThresholds,
  responsibleRoles,
  ticketStartBy,
  visibleTo,
  type AttentionItem,
} from '@/lib/attention';
import en from '@/i18n/messages/en';

const MIN = 60_000;

describe('attention thresholds and levels (audit OPS-01, D4)', () => {
  it('has a realistic recommended warning and urgent time for every kind, urgent always later', () => {
    for (const k of ATTENTION_KINDS) expect(isValidThreshold(DEFAULT_THRESHOLDS[k]), k).toBe(true);
    expect(DEFAULT_THRESHOLDS.order_unaccepted).toEqual({ warn: 2, urgent: 4 });
    expect(DEFAULT_THRESHOLDS.table_request).toEqual({ warn: 1, urgent: 3 });
    expect(DEFAULT_THRESHOLDS.reservation_unconfirmed).toEqual({ warn: 30, urgent: 120 });
  });

  it('turns late and urgent exactly at the thresholds (fixed clock)', () => {
    const t = { warn: 2, urgent: 4 };
    expect(levelFor(0, t)).toBe('waiting');
    expect(levelFor(2 * MIN - 1, t)).toBe('waiting');
    expect(levelFor(2 * MIN, t)).toBe('warning');
    expect(levelFor(4 * MIN - 1, t)).toBe('warning');
    expect(levelFor(4 * MIN, t)).toBe('urgent');
  });

  it('keeps valid stored times per kind and falls back to the recommended ones for missing or invalid entries', () => {
    const r = resolveThresholds({ order_unaccepted: { warn: 5, urgent: 9 }, ticket_overdue: { warn: 30, urgent: 10 }, table_request: { warn: 0, urgent: 2 }, pickup_uncollected: { warn: 2.5, urgent: 9 }, junk: 1 });
    expect(r.order_unaccepted).toEqual({ warn: 5, urgent: 9 });
    expect(r.ticket_overdue).toEqual(DEFAULT_THRESHOLDS.ticket_overdue); // urgent before warning
    expect(r.table_request).toEqual(DEFAULT_THRESHOLDS.table_request); // zero minutes
    expect(r.pickup_uncollected).toEqual(DEFAULT_THRESHOLDS.pickup_uncollected); // not whole minutes
    expect(resolveThresholds(null)).toEqual(DEFAULT_THRESHOLDS);
    expect(resolveThresholds('garbage')).toEqual(DEFAULT_THRESHOLDS);
  });

  it('marks a booking request urgent when it starts within the urgent time, whatever its age', () => {
    const now = new Date('2026-11-06T18:00:00Z');
    const t = DEFAULT_THRESHOLDS.reservation_unconfirmed;
    expect(reservationLevel(new Date(now.getTime() - 10 * MIN), new Date(now.getTime() + 3 * 86_400_000), now, t)).toBe('waiting');
    expect(reservationLevel(new Date(now.getTime() - 45 * MIN), new Date(now.getTime() + 3 * 86_400_000), now, t)).toBe('warning');
    expect(reservationLevel(new Date(now.getTime() - 5 * MIN), new Date(now.getTime() + 90 * MIN), now, t)).toBe('urgent');
  });

  it('starts the "not started" clock of a scheduled pickup at its cooking time, not at acceptance', () => {
    const accepted = new Date('2026-11-06T12:00:00Z');
    expect(ticketStartBy(accepted, null, 20)).toEqual(accepted);
    expect(ticketStartBy(accepted, new Date('2026-11-06T14:00:00Z'), 20)).toEqual(new Date('2026-11-06T13:40:00Z'));
    // Pickup soon: the clock cannot start before the ticket exists.
    expect(ticketStartBy(accepted, new Date('2026-11-06T12:05:00Z'), 20)).toEqual(accepted);
  });
});

describe('who owns and who sees each item', () => {
  const staffed = (...r: MembershipRole[]) => new Set<MembershipRole>(r);

  it('reception owns orders, pickups and bookings; Kitchen and Café own their station type; drivers own deliveries waiting for a driver', () => {
    const all = staffed('RESTAURANT_OWNER', 'WAITER', 'KITCHEN_STAFF', 'CAFE_STAFF', 'DELIVERY_STAFF');
    expect(responsibleRoles('order_unaccepted', null, all)).toEqual(['WAITER']);
    expect(responsibleRoles('pickup_uncollected', null, all)).toEqual(['WAITER']);
    expect(responsibleRoles('reservation_unconfirmed', null, all)).toEqual(['WAITER']);
    expect(responsibleRoles('table_request', null, all)).toEqual(['WAITER', 'CAFE_STAFF']);
    expect(responsibleRoles('ticket_not_started', 'KITCHEN', all)).toEqual(['KITCHEN_STAFF']);
    expect(responsibleRoles('ticket_overdue', 'CAFE', all)).toEqual(['CAFE_STAFF']);
    expect(responsibleRoles('ticket_overdue', 'DRINKS', all)).toEqual(['CAFE_STAFF']);
    expect(responsibleRoles('delivery_no_driver', null, all)).toEqual(['DELIVERY_STAFF']);
  });

  it('falls back to the next role, then to the owner and managers, when nobody with that job works there', () => {
    expect(responsibleRoles('ticket_overdue', 'CAFE', staffed('KITCHEN_STAFF'))).toEqual(['KITCHEN_STAFF']);
    expect(responsibleRoles('delivery_no_driver', null, staffed('WAITER'))).toEqual(['WAITER']);
    expect(responsibleRoles('order_unaccepted', null, staffed('RESTAURANT_OWNER', 'KITCHEN_STAFF'))).toEqual(['RESTAURANT_OWNER', 'RESTAURANT_MANAGER']);
  });

  it('managers get only escalations unless they are responsible; staff see their own work (act-now kinds at once, others once late)', () => {
    const waiters = ['WAITER'] as const;
    expect(visibleTo('WAITER', 'order_unaccepted', 'waiting', waiters)).toBe(true);
    expect(visibleTo('RESTAURANT_MANAGER', 'order_unaccepted', 'warning', waiters)).toBe(false);
    expect(visibleTo('RESTAURANT_MANAGER', 'order_unaccepted', 'urgent', waiters)).toBe(true);
    expect(visibleTo('RESTAURANT_OWNER', 'order_unaccepted', 'waiting', ['RESTAURANT_OWNER', 'RESTAURANT_MANAGER'])).toBe(true);
    expect(visibleTo('KITCHEN_STAFF', 'ticket_not_started', 'waiting', ['KITCHEN_STAFF'])).toBe(false);
    expect(visibleTo('KITCHEN_STAFF', 'ticket_not_started', 'warning', ['KITCHEN_STAFF'])).toBe(true);
    // Not their job: never shown, even urgent (only managers get escalations).
    expect(visibleTo('KITCHEN_STAFF', 'order_unaccepted', 'urgent', waiters)).toBe(false);
    expect(visibleTo('DELIVERY_STAFF', 'ticket_overdue', 'urgent', ['KITCHEN_STAFF'])).toBe(false);
    expect([...ACT_NOW].sort()).toEqual(['delivery_no_driver', 'order_unaccepted', 'reservation_unconfirmed', 'table_request', 'table_request_on_way']);
  });

  it('describes each item in plain words', () => {
    const base: AttentionItem = { key: 'k', kind: 'order_unaccepted', level: 'urgent', entityId: 'x', ageSec: 300, locationId: 'l', locationName: null, nav: 'liveOrders', href: '/' };
    const l = en.shell.attention;
    expect(attentionText({ ...base, orderNumber: 12 }, l)).toBe('Order #12 not accepted');
    expect(attentionText({ ...base, kind: 'ticket_overdue', orderNumber: 7, stationName: 'Café' }, l)).toBe('Café · #7 still preparing');
    expect(attentionText({ ...base, kind: 'table_request', taskType: 'REQUEST_BILL', tableLabel: '4' }, l)).toBe('Table 4 asked for the bill');
    expect(attentionText({ ...base, kind: 'table_request_on_way', taskType: 'CALL_WAITER', tableLabel: '4' }, l)).toBe('Table 4 · on the way, not done');
    expect(attentionText({ ...base, kind: 'reservation_unconfirmed', guestName: 'Ana', partySize: 4 }, l)).toBe('Booking request · Ana, 4 guests');
  });
});
