/**
 * Operational attention: work that is still unresolved, and how late it is (audit OPS-01,
 * OPS-13, D4). Pure functions shared by the server (src/server/services/attention.ts), the
 * settings page and the tests: thresholds, levels, and who is responsible.
 *
 * Nothing here resolves anything. An item exists while its business state is open (order NEW,
 * ticket not ready, pickup not collected, …) and disappears only when that state changes.
 */
import type { MembershipRole, StationType } from '@/generated/prisma/enums';

export const ATTENTION_KINDS = [
  'order_unaccepted',
  'ticket_not_started',
  'ticket_overdue',
  'pickup_uncollected',
  'delivery_no_driver',
  'table_request',
  'table_request_on_way',
  'reservation_unconfirmed',
] as const;
export type AttentionKind = (typeof ATTENTION_KINDS)[number];
/** `waiting`: open but still within time. */
export type AttentionLevel = 'waiting' | 'warning' | 'urgent';
export const LEVEL_RANK: Record<AttentionLevel, number> = { waiting: 0, warning: 1, urgent: 2 };
/** Minutes after which an item becomes a warning, then urgent (escalated to managers). */
export type Threshold = { warn: number; urgent: number };
export type Thresholds = Record<AttentionKind, Threshold>;

/**
 * Recommended times for a typical restaurant (audit D4). Each location can change them in
 * Settings → Alerts & timings.
 */
export const DEFAULT_THRESHOLDS: Thresholds = {
  order_unaccepted: { warn: 2, urgent: 4 },
  ticket_not_started: { warn: 8, urgent: 15 },
  ticket_overdue: { warn: 20, urgent: 30 },
  pickup_uncollected: { warn: 10, urgent: 20 },
  delivery_no_driver: { warn: 5, urgent: 10 },
  table_request: { warn: 1, urgent: 3 },
  table_request_on_way: { warn: 5, urgent: 10 },
  reservation_unconfirmed: { warn: 30, urgent: 120 },
};

/** What each timing means, in the words shown on the settings page. */
export const KIND_INFO: Record<AttentionKind, { title: string; from: string }> = {
  order_unaccepted: { title: 'New order not accepted', from: 'Counted from when the guest placed the order.' },
  ticket_not_started: { title: 'Kitchen or Café ticket not started', from: 'Counted from when the order was accepted. For a pickup scheduled later: from when cooking should start (pickup time minus the takeaway lead time).' },
  ticket_overdue: { title: 'Ticket still being prepared', from: 'Counted from when the station tapped Start.' },
  pickup_uncollected: { title: 'Pickup ready, not collected', from: 'Counted from when it was ready, or from the chosen pickup time if that is later.' },
  delivery_no_driver: { title: 'Delivery ready, no driver', from: 'Counted from when it was ready. Ends when a driver takes it.' },
  table_request: { title: 'Waiter, bill or “open my table” request not answered', from: 'Counted from when the guest asked from the table.' },
  table_request_on_way: { title: 'Table request “On my way” but not done', from: 'Counted from when someone tapped On my way. It stays open until Done.' },
  reservation_unconfirmed: { title: 'Booking request not answered', from: 'Counted from when the guest asked. Also urgent when the booking starts within the urgent time.' },
};

/**
 * Kinds shown to their owners from the moment they appear (as "waiting"): they need someone now,
 * or (a table request someone is "on the way" to) must stay visible as open until done. Tickets
 * and ready pickups are normal work in progress until they are late.
 */
export const ACT_NOW: ReadonlySet<AttentionKind> = new Set(['order_unaccepted', 'delivery_no_driver', 'table_request', 'table_request_on_way', 'reservation_unconfirmed']);

/** Whole minutes between 1 and 1440 (24 hours), urgent strictly later than the warning. */
export const MAX_THRESHOLD_MINUTES = 1440;
export function isValidThreshold(v: unknown): v is Threshold {
  const t = v as Partial<Threshold> | null;
  const ok = (n: unknown) => typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= MAX_THRESHOLD_MINUTES;
  return !!t && typeof t === 'object' && ok(t.warn) && ok(t.urgent) && t.urgent! > t.warn!;
}

/** Stored per location (JSON). Missing or invalid kinds fall back to the recommended times. */
export function resolveThresholds(stored: unknown): Thresholds {
  const s = (stored && typeof stored === 'object' ? stored : {}) as Record<string, unknown>;
  return Object.fromEntries(
    ATTENTION_KINDS.map((k) => {
      const t = s[k];
      return [k, isValidThreshold(t) ? { warn: t.warn, urgent: t.urgent } : DEFAULT_THRESHOLDS[k]];
    }),
  ) as Thresholds;
}

export function levelFor(ageMs: number, t: Threshold): AttentionLevel {
  if (ageMs >= t.urgent * 60_000) return 'urgent';
  if (ageMs >= t.warn * 60_000) return 'warning';
  return 'waiting';
}

/** A booking request is also urgent when it starts within the urgent time and is still unanswered. */
export function reservationLevel(createdAt: Date, startsAt: Date, now: Date, t: Threshold): AttentionLevel {
  const byAge = levelFor(now.getTime() - createdAt.getTime(), t);
  return startsAt.getTime() - now.getTime() <= t.urgent * 60_000 ? 'urgent' : byAge;
}

/** When a ticket's "not started" clock starts: accepted, or later for a pickup scheduled ahead. */
export function ticketStartBy(ticketCreatedAt: Date, pickupAt: Date | null, leadMinutes: number): Date {
  const cookFrom = pickupAt ? pickupAt.getTime() - leadMinutes * 60_000 : 0;
  return new Date(Math.max(ticketCreatedAt.getTime(), cookFrom));
}

/** Sidebar sections an item belongs to (keys of NAV_ITEMS). */
export type AttentionNav = 'liveOrders' | 'kitchen' | 'tasks' | 'reservations' | 'myDeliveries';
export type AttentionItem = {
  key: string;
  kind: AttentionKind;
  level: AttentionLevel;
  entityId: string;
  /** Seconds the work has been open (by its own clock, see KIND_INFO), at `serverTime`. */
  ageSec: number;
  locationId: string;
  /** Only when the person works at several locations. */
  locationName: string | null;
  nav: AttentionNav;
  /** Opens the exact order, ticket, request or booking. */
  href: string;
  orderNumber?: number;
  stationName?: string;
  tableLabel?: string | null;
  taskType?: 'CALL_WAITER' | 'REQUEST_BILL' | 'OPEN_TABLE';
  guestName?: string;
  partySize?: number;
};
export type AttentionSummary = {
  serverTime: string;
  total: number;
  levels: Record<AttentionLevel, number>;
  byNav: Partial<Record<AttentionNav, { count: number; level: AttentionLevel }>>;
  /** Most urgent first, then the longest waiting (capped; `total` counts all). */
  items: AttentionItem[];
};

/** The item texts (Messages['shell']['attention']). */
export type AttentionTextLabels = Record<
  'orderUnaccepted' | 'ticketNotStarted' | 'ticketOverdue' | 'pickupUncollected' | 'deliveryNoDriver' | 'callWaiter' | 'requestBill' | 'openTable' | 'onTheWay' | 'reservation',
  string
>;
export const fillText = (t: string, v: Record<string, string | number | null | undefined>) => t.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? '?'));
export function attentionText(i: AttentionItem, l: AttentionTextLabels) {
  const v = { n: i.orderNumber, station: i.stationName, table: i.tableLabel, name: i.guestName, party: i.partySize };
  const template = {
    order_unaccepted: l.orderUnaccepted,
    ticket_not_started: l.ticketNotStarted,
    ticket_overdue: l.ticketOverdue,
    pickup_uncollected: l.pickupUncollected,
    delivery_no_driver: l.deliveryNoDriver,
    table_request: i.taskType === 'REQUEST_BILL' ? l.requestBill : i.taskType === 'OPEN_TABLE' ? l.openTable : l.callWaiter,
    table_request_on_way: l.onTheWay,
    reservation_unconfirmed: l.reservation,
  }[i.kind];
  return fillText(template, v);
}

export const MANAGER_ROLES: readonly MembershipRole[] = ['RESTAURANT_OWNER', 'RESTAURANT_MANAGER'];

/**
 * Who owns each kind of work, in order of preference: reception (waiters) accepts orders, hands
 * over pickups and answers tables and bookings; Kitchen / Café staff own their station's tickets
 * (by station type); drivers own deliveries waiting for a driver (reception when the location has
 * no driver accounts and staff send deliveries out themselves).
 */
export function ownerTiers(kind: AttentionKind, stationType?: StationType | null): MembershipRole[][] {
  switch (kind) {
    case 'order_unaccepted':
    case 'pickup_uncollected':
    case 'reservation_unconfirmed':
      return [['WAITER']];
    case 'table_request':
    case 'table_request_on_way':
      return [['WAITER', 'CAFE_STAFF']];
    case 'ticket_not_started':
    case 'ticket_overdue':
      return stationType === 'CAFE' || stationType === 'DRINKS' ? [['CAFE_STAFF'], ['KITCHEN_STAFF']] : [['KITCHEN_STAFF'], ['CAFE_STAFF']];
    case 'delivery_no_driver':
      return [['DELIVERY_STAFF'], ['WAITER']];
  }
}

/**
 * The roles responsible at one location: the first tier with someone who works there. Nobody at
 * all → the owner and managers are responsible themselves (a small restaurant run by its owner).
 */
export function responsibleRoles(kind: AttentionKind, stationType: StationType | null | undefined, staffed: ReadonlySet<MembershipRole>): readonly MembershipRole[] {
  for (const tier of ownerTiers(kind, stationType)) {
    const here = tier.filter((r) => staffed.has(r));
    if (here.length) return here;
  }
  return MANAGER_ROLES;
}

/**
 * Whether one person is shown an item. The responsible role sees it from the start for work that
 * needs someone now, otherwise once it is late. Owners and managers who are not responsible see
 * only escalations (urgent), so they are not flooded with the team's normal work.
 */
export function visibleTo(role: MembershipRole, kind: AttentionKind, level: AttentionLevel, responsible: readonly MembershipRole[]): boolean {
  if (responsible.includes(role)) return level !== 'waiting' || ACT_NOW.has(kind);
  return MANAGER_ROLES.includes(role) && level === 'urgent';
}
