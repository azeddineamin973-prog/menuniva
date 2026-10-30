import 'server-only';
import { redirect } from 'next/navigation';
import { effectiveModules, type ModuleKey } from '@/lib/modules';
import { db, type Tx } from './db';
import { UserFacingError } from './errors';
import { getPlatformConfig } from './services/platform-config';

/** Feature modules available to an organization right now (plan + trial + Super Admin toggles). */
/** Base modules (plan, or all during an included trial), Super Admin overrides and the result. */
export async function orgModuleState(organizationId: string, now = new Date(), tx: Tx | typeof db = db) {
  const [org, config] = await Promise.all([
    tx.restaurantOrganization.findUnique({ where: { id: organizationId }, select: { enabledModules: true, disabledModules: true, subscription: { select: { status: true, trialEndsAt: true, plan: { select: { features: true } } } } } }),
    getPlatformConfig(),
  ]);
  if (!org) return null;
  const sub = org.subscription;
  const trialActive = !!sub && sub.status === 'TRIALING' && (!sub.trialEndsAt || sub.trialEndsAt > now);
  const common = { planFeatures: sub?.plan.features ?? null, trialActive, trialIncludesAll: config.trialIncludesAllModules };
  return {
    base: effectiveModules({ ...common, enabled: [], disabled: [] }),
    effective: effectiveModules({ ...common, enabled: org.enabledModules, disabled: org.disabledModules }),
    enabled: org.enabledModules,
    disabled: org.disabledModules,
  };
}

export async function orgModules(organizationId: string, now = new Date(), tx: Tx | typeof db = db): Promise<Set<ModuleKey>> {
  return (await orgModuleState(organizationId, now, tx))?.effective ?? new Set();
}

export async function hasModule(organizationId: string, module: ModuleKey, tx?: Tx): Promise<boolean> {
  return (await orgModules(organizationId, new Date(), tx)).has(module);
}

/** Server-side gate used by services. Guests and staff get the same stable error code. */
export async function assertModule(organizationId: string, module: ModuleKey, tx?: Tx) {
  if (!(await hasModule(organizationId, module, tx))) throw new UserFacingError('module_not_available', 403, { module });
}

/** Dashboard page gate: sections outside the tenant's modules explain why instead of failing. */
export async function requireModulePage(ctx: { org: { id: string; slug: string } }, module: ModuleKey) {
  if (!(await hasModule(ctx.org.id, module))) redirect(`/dashboard/${ctx.org.slug}/unavailable?m=${module}`);
}
