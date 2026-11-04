import { isModuleKey, type ModuleKey } from '@/lib/modules';

/** Subscription plan as stored (Super Admin → Plans). */
export type PlanRow = {
  code: string;
  name: string;
  description: string | null;
  monthlyPriceCents: number | null;
  currency: string;
  limits: unknown;
  features: readonly string[];
};

export type PlanLimitKey = 'locations' | 'tables' | 'staff' | 'menuItems';

/** What a plan card shows. `price` is null while the price is not set ("on request"). */
export type PlanCard = {
  code: string;
  name: string;
  description: string | null;
  price: string | null;
  limits: { key: PlanLimitKey; text: string }[];
  /** Name of the previous plan when this plan includes all of its features. */
  includesFrom: string | null;
  features: string[];
};

/** Public wording for each module (the dashboard labels are written for owners and admins). */
const FEATURE_COPY: Record<ModuleKey, string> = {
  table_ordering: 'QR table ordering',
  kds: 'Kitchen & café displays',
  translations: 'Menu translations',
  import: 'Menu Import Studio',
  feedback: 'Private feedback & Google link',
  takeaway: 'Takeaway & pickup slots',
  delivery: 'Your own delivery',
  promotions: 'Promotions & codes',
  reservations: 'Reservations',
  upsell: 'Cart suggestions',
  loyalty: 'Loyalty points & stamps',
  analytics_export: 'Analytics CSV export',
};

const LIMIT_COPY: [PlanLimitKey, string, string][] = [
  ['locations', 'location', 'locations'],
  ['tables', 'table', 'tables'],
  ['staff', 'staff account', 'staff accounts'],
  ['menuItems', 'dish', 'dishes'],
];

const count = new Intl.NumberFormat('en');

/** 4900 → "€49", 4950 → "€49.50". */
export function formatPlanPrice(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency, minimumFractionDigits: cents % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 }).format(cents / 100);
  } catch {
    // Unknown currency code typed in Super Admin: show the amount rather than fail the page.
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

function limitLines(raw: unknown): PlanCard['limits'] {
  if (!raw || typeof raw !== 'object') return [];
  const limits = raw as Record<string, unknown>;
  return LIMIT_COPY.flatMap(([key, one, many]) => {
    const n = limits[key];
    return typeof n === 'number' && Number.isFinite(n) && n > 0 ? [{ key, text: `${count.format(n)} ${n === 1 ? one : many}` }] : [];
  });
}

/**
 * Plan cards in display order. When a plan contains every feature of the plan before it, the card
 * lists only what it adds ("Everything in Starter, plus").
 */
export function toPlanCards(rows: readonly PlanRow[]): PlanCard[] {
  return rows.map((plan, i) => {
    const own = plan.features.filter(isModuleKey);
    const prev = i > 0 ? rows[i - 1] : null;
    const prevKeys = prev ? prev.features.filter(isModuleKey) : [];
    const builds = prev !== null && prevKeys.length > 0 && prevKeys.every((f) => own.includes(f));
    const shown = builds ? own.filter((f) => !prevKeys.includes(f)) : own;
    return {
      code: plan.code,
      name: plan.name,
      description: plan.description,
      price: plan.monthlyPriceCents === null ? null : formatPlanPrice(plan.monthlyPriceCents, plan.currency),
      limits: limitLines(plan.limits),
      includesFrom: builds && prev ? prev.name : null,
      features: shown.map((f) => FEATURE_COPY[f]),
    };
  });
}
