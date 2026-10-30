/** Feature modules that plans include and Super Admin can switch per tenant. */
export const MODULES = ['table_ordering', 'kds', 'translations', 'import', 'feedback', 'takeaway', 'delivery', 'promotions', 'reservations', 'upsell', 'loyalty', 'analytics_export'] as const;
export type ModuleKey = (typeof MODULES)[number];

export const MODULE_LABELS: Record<ModuleKey, string> = {
  table_ordering: 'Table QR ordering',
  kds: 'Kitchen display',
  translations: 'Automatic translation',
  import: 'Menu import',
  feedback: 'Guest feedback & reviews',
  takeaway: 'Takeaway / pickup',
  delivery: 'Own delivery',
  promotions: 'Promotions & codes',
  reservations: 'Reservations',
  upsell: 'Cart suggestions',
  loyalty: 'Loyalty',
  analytics_export: 'Analytics CSV export',
};

export function isModuleKey(v: string): v is ModuleKey {
  return (MODULES as readonly string[]).includes(v);
}

/**
 * Effective modules of a tenant: what the plan includes (or everything during an active trial,
 * when the platform allows it), plus add-ons switched on by Super Admin, minus modules that
 * Super Admin switched off for this tenant.
 */
export function effectiveModules(p: {
  planFeatures: readonly string[] | null;
  trialActive: boolean;
  trialIncludesAll: boolean;
  enabled: readonly string[];
  disabled: readonly string[];
}): Set<ModuleKey> {
  const base: readonly string[] = p.trialActive && p.trialIncludesAll ? MODULES : (p.planFeatures ?? []);
  const out = new Set<ModuleKey>();
  for (const m of [...base, ...p.enabled]) if (isModuleKey(m)) out.add(m);
  for (const m of p.disabled) if (isModuleKey(m)) out.delete(m);
  return out;
}
