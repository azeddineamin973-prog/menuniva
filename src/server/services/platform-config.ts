import 'server-only';
import { z } from 'zod';
import { audit } from '../audit';
import { db } from '../db';

/**
 * Platform settings editable by Super Admin (PlatformConfig table). Every key has a safe
 * default so the platform works before anything is configured.
 */
export const configSchema = z.object({
  signupsOpen: z.boolean(),
  defaultTrialDays: z.coerce.number().int().min(0).max(365),
  trialIncludesAllModules: z.boolean(),
  supportEmail: z.preprocess((v) => (v === '' || v == null ? null : v), z.string().trim().toLowerCase().email().max(254).nullable()),
});
export type PlatformConfigValues = z.infer<typeof configSchema>;

export const CONFIG_DEFAULTS: PlatformConfigValues = { signupsOpen: true, defaultTrialDays: 30, trialIncludesAllModules: true, supportEmail: null };

export async function getPlatformConfig(): Promise<PlatformConfigValues> {
  const rows = await db.platformConfig.findMany({ where: { key: { in: Object.keys(CONFIG_DEFAULTS) } } });
  const merged: Record<string, unknown> = { ...CONFIG_DEFAULTS };
  for (const r of rows) merged[r.key] = r.value;
  const parsed = configSchema.safeParse(merged);
  return parsed.success ? parsed.data : CONFIG_DEFAULTS;
}

export async function updatePlatformConfig(adminId: string, input: unknown) {
  const data = configSchema.parse(input);
  const before = await getPlatformConfig();
  await db.$transaction(
    Object.entries(data).map(([key, value]) =>
      db.platformConfig.upsert({ where: { key }, update: { value: value as never, updatedById: adminId }, create: { key, value: value as never, updatedById: adminId } }),
    ),
  );
  await audit({ actorUserId: adminId, action: 'platform.config_updated', entityType: 'PlatformConfig', metadata: { before, after: data } });
}
