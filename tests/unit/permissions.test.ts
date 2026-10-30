import { describe, expect, it } from 'vitest';
import { assignableRoles, can } from '@/lib/permissions';

describe('role permissions', () => {
  it('kitchen staff cannot see billing, analytics or staff management', () => {
    expect(can('KITCHEN_STAFF', 'kds.view')).toBe(true);
    expect(can('KITCHEN_STAFF', 'billing.view')).toBe(false);
    expect(can('KITCHEN_STAFF', 'analytics.view')).toBe(false);
    expect(can('KITCHEN_STAFF', 'staff.manage')).toBe(false);
  });
  it('delivery staff only gets the driver view', () => {
    expect(can('DELIVERY_STAFF', 'delivery.driver')).toBe(true);
    expect(can('DELIVERY_STAFF', 'analytics.view')).toBe(false);
    expect(can('DELIVERY_STAFF', 'orders.view')).toBe(false);
  });
  it('managers cannot see subscription billing; owners can', () => {
    expect(can('RESTAURANT_MANAGER', 'billing.view')).toBe(false);
    expect(can('RESTAURANT_OWNER', 'billing.view')).toBe(true);
  });
  it('managers cannot assign owner or manager roles', () => {
    expect(assignableRoles('RESTAURANT_MANAGER')).not.toContain('RESTAURANT_OWNER');
    expect(assignableRoles('RESTAURANT_MANAGER')).not.toContain('RESTAURANT_MANAGER');
    expect(assignableRoles('WAITER')).toEqual([]);
  });
});
