import 'server-only';
import { cache } from 'react';
import { effectiveModules, type ModuleKey } from '@/lib/modules';
import { db, type Tx } from './db';
import { UserFacingError } from './errors';
import { getPlatformConfig } from './services/platform-config';

/** Feature modules available to an organization right now (plan + trial + Super Admin toggles). */
/** Base modules (plan, or all during an included trial), Super Admin overrides and the result. */
export async function orgModuleState(organizationId: string, now = new Date(), tx: Tx | typeof db = db) {
  const [org, config] = await Promise.all([
    tx.restaurantOrganization.findUnique({ where: { id: organizationId }, select: { enabledModules: true, disabledModules: true, subscription: { select: { status: true, trialEndsAt: true, plan: { select: { features: true } } } } } }),
    getPlatformConfig(tx),
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

/** One read per organization per page render (layout, page and guards all ask). Outside a render (actions, API routes) it is not memoized. */
const currentModuleState = cache((organizationId: string) => orgModuleState(organizationId));

export async function orgModules(organizationId: string, now?: Date, tx?: Tx | typeof db): Promise<Set<ModuleKey>> {
  const state = now || tx ? await orgModuleState(organizationId, now ?? new Date(), tx ?? db) : await currentModuleState(organizationId);
  // A copy: callers may not change the memoized set.
  return new Set(state?.effective ?? []);
}

export async function hasModule(organizationId: string, module: ModuleKey, tx?: Tx | typeof db): Promise<boolean> {
  return (await orgModules(organizationId, undefined, tx)).has(module);
}

/** Server-side gate used by services. Guests and staff get the same stable error code. */
export async function assertModule(organizationId: string, module: ModuleKey, tx?: Tx) {
  if (!(await hasModule(organizationId, module, tx))) throw new UserFacingError('module_not_available', 403, { module });
}

