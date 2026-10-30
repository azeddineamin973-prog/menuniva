import type { OrderChannel, OrderStatus } from '@/generated/prisma/enums';

/**
 * Explicit order state machine (Part 8). Any transition not listed here is rejected by the
 * server. COMPLETED and CANCELLED are terminal.
 */
const COMMON: Partial<Record<OrderStatus, OrderStatus[]>> = {
  NEW: ['ACCEPTED', 'CANCELLED'],
  ACCEPTED: ['PREPARING', 'READY', 'CANCELLED'],
  PREPARING: ['READY', 'CANCELLED'],
};

export const TRANSITIONS: Record<OrderChannel, Partial<Record<OrderStatus, OrderStatus[]>>> = {
  TABLE: { ...COMMON, READY: ['COMPLETED', 'CANCELLED'] },
  TAKEAWAY: { ...COMMON, READY: ['COMPLETED', 'CANCELLED'] },
  DELIVERY: {
    ...COMMON,
    READY: ['OUT_FOR_DELIVERY', 'CANCELLED'],
    OUT_FOR_DELIVERY: ['DELIVERED', 'CANCELLED'],
    DELIVERED: ['COMPLETED'],
  },
};

export function canTransition(channel: OrderChannel, from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[channel][from]?.includes(to) ?? false;
}

export function nextStatuses(channel: OrderChannel, from: OrderStatus): OrderStatus[] {
  return TRANSITIONS[channel][from] ?? [];
}

export const ACTIVE_STATUSES: OrderStatus[] = ['NEW', 'ACCEPTED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'DELIVERED'];
export const TERMINAL_STATUSES: OrderStatus[] = ['COMPLETED', 'CANCELLED'];

/** Progress steps shown to the customer for each channel. */
export const CUSTOMER_STEPS: Record<OrderChannel, OrderStatus[]> = {
  TABLE: ['NEW', 'ACCEPTED', 'PREPARING', 'READY', 'COMPLETED'],
  TAKEAWAY: ['NEW', 'ACCEPTED', 'PREPARING', 'READY', 'COMPLETED'],
  DELIVERY: ['NEW', 'ACCEPTED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'DELIVERED'],
};
