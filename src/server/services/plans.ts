import 'server-only';
import { db } from '../db';

/**
 * Default, configurable SaaS plans. Names, limits and prices are placeholders for the
 * founder to adjust in Super Admin → Plans; they are NOT final commercial pricing.
 * MenuNiva charges no per-order commission on its own ordering channels.
 */
export const DEFAULT_PLANS = [
  {
    code: 'starter',
    name: 'Starter',
    description: 'One location, QR menu and table ordering.',
    monthlyPriceCents: null,
    limits: { locations: 1, tables: 30, staff: 8, menuItems: 250 },
    features: ['table_ordering', 'kds', 'translations', 'import', 'feedback'],
    sortOrder: 1,
  },
  {
    code: 'growth',
    name: 'Growth',
    description: 'Adds takeaway, delivery, promotions and reservations.',
    monthlyPriceCents: null,
    limits: { locations: 1, tables: 80, staff: 25, menuItems: 600 },
    features: ['table_ordering', 'kds', 'translations', 'import', 'feedback', 'takeaway', 'delivery', 'promotions', 'reservations', 'upsell'],
    sortOrder: 2,
  },
  {
    code: 'pro',
    name: 'Pro',
    description: 'Multiple locations, loyalty and advanced analytics.',
    monthlyPriceCents: null,
    limits: { locations: 5, tables: 300, staff: 100, menuItems: 2000 },
    features: ['table_ordering', 'kds', 'translations', 'import', 'feedback', 'takeaway', 'delivery', 'promotions', 'reservations', 'upsell', 'loyalty', 'analytics_export'],
    sortOrder: 3,
  },
  {
    code: 'enterprise',
    name: 'Enterprise / Custom',
    description: 'Custom limits and integrations, agreed individually.',
    monthlyPriceCents: null,
    limits: { locations: 100, tables: 5000, staff: 2000, menuItems: 20000 },
    features: ['table_ordering', 'kds', 'translations', 'import', 'feedback', 'takeaway', 'delivery', 'promotions', 'reservations', 'upsell', 'loyalty', 'analytics_export'],
    sortOrder: 4,
  },
] as const;

/** Idempotent: creates missing default plans, never overwrites edited plans. */
export async function ensureDefaultPlans() {
  for (const p of DEFAULT_PLANS) {
    await db.subscriptionPlan.upsert({
      where: { code: p.code },
      update: {},
      create: { ...p, limits: p.limits, features: [...p.features] },
    });
  }
}

export const DEFAULT_TRIAL_DAYS = 30;
