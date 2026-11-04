import 'server-only';
import { cache } from 'react';
import { effectiveModules, type ModuleKey } from '@/lib/modules';
import { db, type Tx } from './db';
import { UserFacingError } from './errors';
import { getPlatformConfig } from './services/platform-config';

/** Feature modules available to an organization right now (plan + trial + Super Admin toggles). */
/** Base modules (plan, or all during an included trial), Super Admin overrides and the result. */
export async function orgModuleState(organizationId: string, now = new Date(), tx: Tx | typeof db = db) {
  // One statement for the organisation, its subscription and the plan: as a nested Prisma read these
  // were three queries one after the other, and every page, guard and guest order asks for this, each
  // time paying the database round trip three times (final QA, +80 ms: about 0.25 s per call). The
  // trial is decided in SQL against `now` as UTC, the way Prisma stores DateTime (timestamp(3)).
  const [rows, config] = await Promise.all([
    tx.$queryRaw<{ enabledModules: string[]; disabledModules: string[]; hasSubscription: boolean; trialActive: boolean; planFeatures: string[] | null }[]>`
      SELECT o."enabledModules"::text[] AS "enabledModules", o."disabledModules"::text[] AS "disabledModules",
             (s.id IS NOT NULL) AS "hasSubscription",
             COALESCE(s.status = 'TRIALING' AND (s."trialEndsAt" IS NULL OR s."trialEndsAt" > (${now.toISOString()}::timestamptz AT TIME ZONE 'UTC')), false) AS "trialActive",
             p.features::text[] AS "planFeatures"
        FROM "RestaurantOrganization" o
        LEFT JOIN "Subscription" s ON s."organizationId" = o.id
        LEFT JOIN "SubscriptionPlan" p ON p.id = s."planId"
       WHERE o.id = ${organizationId}`,
    getPlatformConfig(tx),
  ]);
  const org = rows[0];
  if (!org) return null;
  const common = { planFeatures: org.hasSubscription ? (org.planFeatures ?? []) : null, trialActive: org.trialActive, trialIncludesAll: config.trialIncludesAllModules };
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

