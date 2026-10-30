import 'server-only';
import { z } from 'zod';
import type { CountryCode, LanguageCode } from '@/generated/prisma/enums';
import { RESERVED_SLUGS, slugify } from '@/lib/slug';
import { audit } from '../audit';
import { db, type Tx } from '../db';
import { ensureDefaultPlans } from './plans';
import { getPlatformConfig } from './platform-config';

export const COUNTRY_DEFAULTS: Record<CountryCode, { timeZone: string; language: LanguageCode; currency: string }> = {
  PT: { timeZone: 'Europe/Lisbon', language: 'pt', currency: 'EUR' },
  ES: { timeZone: 'Europe/Madrid', language: 'es', currency: 'EUR' },
};

export const createRestaurantSchema = z.object({
  name: z.string().trim().min(2).max(100),
  country: z.enum(['PT', 'ES']),
  defaultLanguage: z.enum(['pt', 'en', 'fr', 'ar', 'es']).optional(),
  locationName: z.string().trim().min(2).max(100).optional(),
  city: z.string().trim().max(80).optional(),
});
export type CreateRestaurantInput = z.infer<typeof createRestaurantSchema>;

async function uniqueSlug(tx: Tx, base: string): Promise<string> {
  const root = RESERVED_SLUGS.has(base) ? `${base}-restaurant` : base;
  for (let i = 1; i < 1000; i++) {
    const candidate = i === 1 ? root : `${root}-${i}`;
    const exists = await tx.restaurantOrganization.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!exists) return candidate;
  }
  throw new Error('Could not allocate a unique slug');
}

/**
 * Creates a complete restaurant tenant in one transaction:
 * organization, branding, settings, first location (with channel settings rows),
 * owner membership and a manual trial subscription.
 */
export async function createRestaurant(
  input: CreateRestaurantInput,
  opts: { ownerUserId?: string; actorUserId: string | null; isDemo?: boolean },
) {
  const data = createRestaurantSchema.parse(input);
  await ensureDefaultPlans();
  const { defaultTrialDays } = await getPlatformConfig();
  const defaults = COUNTRY_DEFAULTS[data.country];
  const lang = data.defaultLanguage ?? defaults.language;
  return db.$transaction(async (tx) => {
    const slug = await uniqueSlug(tx, slugify(data.name));
    const starter = await tx.subscriptionPlan.findUniqueOrThrow({ where: { code: 'starter' } });
    const org = await tx.restaurantOrganization.create({
      data: {
        slug,
        name: data.name,
        country: data.country,
        currency: defaults.currency,
        defaultLanguage: lang,
        sourceLanguage: lang,
        isDemo: opts.isDemo ?? false,
        branding: { create: {} },
        settings: { create: {} },
        subscription: {
          create: {
            planId: starter.id,
            status: 'TRIALING',
            trialEndsAt: new Date(Date.now() + defaultTrialDays * 86400_000),
            provider: 'manual',
          },
        },
        loyaltyProgram: { create: { enabled: false } },
      },
    });
    const location = await tx.restaurantLocation.create({
      data: {
        organizationId: org.id,
        slug: slugify(data.locationName ?? data.city ?? 'main'),
        name: data.locationName ?? data.name,
        city: data.city ?? null,
        country: data.country,
        timeZone: defaults.timeZone,
        takeawaySettings: { create: {} },
        deliverySettings: { create: {} },
        reservationSettings: { create: {} },
        reviewSettings: { create: {} },
      },
    });
    await tx.menu.create({ data: { organizationId: org.id, name: 'Menu' } });
    if (opts.ownerUserId) {
      await tx.restaurantMembership.create({
        data: { userId: opts.ownerUserId, organizationId: org.id, role: 'RESTAURANT_OWNER' },
      });
    }
    await audit(
      {
        organizationId: org.id,
        actorUserId: opts.actorUserId,
        action: 'organization.created',
        entityType: 'RestaurantOrganization',
        entityId: org.id,
        metadata: { name: org.name, country: org.country, isDemo: org.isDemo },
      },
      tx,
    );
    return { org, location };
  });
}

/** Organizations the user belongs to (active memberships only). */
export async function listUserOrganizations(userId: string) {
  return db.restaurantMembership.findMany({
    where: { userId, status: 'ACTIVE' },
    include: { organization: { select: { id: true, slug: true, name: true, status: true, isDemo: true } } },
    orderBy: { createdAt: 'asc' },
  });
}
