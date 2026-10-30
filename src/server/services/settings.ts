import 'server-only';
import { z } from 'zod';
import { LANGUAGES } from '@/i18n/config';
import { openingHoursSchema } from '@/lib/opening-hours';
import { isValidPostalCode, normalizePostalCode } from '@/lib/postal';
import { audit } from '../audit';
import { UserFacingError } from '../errors';
import { db } from '../db';
import { deleteTenantMedia, withStoredImages } from '../media';
import { assertLocationAccess, type TenantContext } from '../tenant';

const optText = (max: number) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().max(max).nullable().optional());
const phone = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
  z.string().trim().regex(/^\+?[0-9 ()-]{6,20}$/, 'invalid_phone').nullable().optional(),
);
const httpsUrl = (hosts?: RegExp) =>
  z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
    z
      .string()
      .trim()
      .max(500)
      .url('invalid_url')
      .refine((u) => u.startsWith('https://'), 'https_required')
      .refine((u) => !hosts || hosts.test(new URL(u).hostname), 'wrong_domain')
      .nullable()
      .optional(),
  );

export const organizationSettingsSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    legalName: optText(150),
    taxId: optText(30),
    country: z.enum(['PT', 'ES']),
    defaultLanguage: z.enum(LANGUAGES as [string, ...string[]]),
    sourceLanguage: z.enum(LANGUAGES as [string, ...string[]]),
    enabledLanguages: z.array(z.enum(LANGUAGES as [string, ...string[]])).min(1),
  })
  .refine((d) => d.enabledLanguages.includes(d.defaultLanguage), { path: ['defaultLanguage'], message: 'default_must_be_enabled' })
  .refine((d) => d.enabledLanguages.includes(d.sourceLanguage), { path: ['sourceLanguage'], message: 'source_must_be_enabled' });

export async function updateOrganizationSettings(ctx: TenantContext, input: unknown) {
  const data = organizationSettingsSchema.parse(input);
  await db.restaurantOrganization.update({
    where: { id: ctx.org.id },
    data: {
      name: data.name,
      legalName: data.legalName ?? null,
      taxId: data.taxId ?? null,
      country: data.country,
      defaultLanguage: data.defaultLanguage as never,
      sourceLanguage: data.sourceLanguage as never,
      enabledLanguages: data.enabledLanguages as never,
    },
  });
  await audit({ organizationId: ctx.org.id, actorUserId: ctx.userId, action: 'settings.organization_updated', entityType: 'RestaurantOrganization', entityId: ctx.org.id });
}

export const locationDetailsSchema = z.object({
  locationId: z.string().min(1),
  name: z.string().trim().min(2).max(100),
  addressLine1: optText(200),
  addressLine2: optText(200),
  postalCode: optText(12),
  city: optText(80),
  phone,
  whatsappNumber: phone,
  email: z.preprocess((v) => (v === '' ? null : v), z.string().trim().email().max(254).nullable().optional()),
  timeZone: z.enum(['Europe/Lisbon', 'Europe/Madrid', 'Atlantic/Canary', 'Atlantic/Azores', 'Atlantic/Madeira']),
  openingHours: z.preprocess((v) => (typeof v === 'string' && v ? JSON.parse(v) : null), openingHoursSchema.nullable()),
});

export async function updateLocationDetails(ctx: TenantContext, input: unknown) {
  const data = locationDetailsSchema.parse(input);
  await assertLocationAccess(ctx, data.locationId);
  const location = await db.restaurantLocation.findUniqueOrThrow({ where: { id: data.locationId } });
  let postalCode = data.postalCode ?? null;
  if (postalCode) {
    if (!isValidPostalCode(location.country, postalCode)) {
      throw new z.ZodError([{ code: 'custom', path: ['postalCode'], message: location.country === 'PT' ? 'invalid_postal_pt' : 'invalid_postal_es', input: postalCode }]);
    }
    postalCode = normalizePostalCode(location.country, postalCode);
  }
  await db.restaurantLocation.update({
    where: { id: location.id },
    data: {
      name: data.name,
      addressLine1: data.addressLine1 ?? null,
      addressLine2: data.addressLine2 ?? null,
      postalCode,
      city: data.city ?? null,
      phone: data.phone ?? null,
      whatsappNumber: data.whatsappNumber ?? null,
      email: data.email ?? null,
      timeZone: data.timeZone,
      openingHours: data.openingHours ?? undefined,
    },
  });
  await audit({ organizationId: ctx.org.id, actorUserId: ctx.userId, action: 'settings.location_updated', entityType: 'RestaurantLocation', entityId: location.id });
}

const bool = z.preprocess((v) => v === 'on' || v === 'true' || v === true, z.boolean());

export const channelSettingsSchema = z.object({
  locationId: z.string().min(1),
  tableOrderingEnabled: bool,
  takeawayEnabled: bool,
  deliveryEnabled: bool,
  reservationsEnabled: bool,
  whatsappOrderingEnabled: bool,
  orderingPaused: bool,
  tableCodeRequired: bool,
  glovoUrl: httpsUrl(/(^|\.)glovoapp\.com$/),
  uberEatsUrl: httpsUrl(/(^|\.)ubereats\.com$/),
  websiteUrl: httpsUrl(),
  instagramUrl: httpsUrl(/(^|\.)instagram\.com$/),
  facebookUrl: httpsUrl(/(^|\.)(facebook\.com|fb\.com)$/),
  tiktokUrl: httpsUrl(/(^|\.)tiktok\.com$/),
  googleReviewUrl: httpsUrl(/(^|\.)(google\.[a-z.]+|g\.page|goo\.gl|maps\.app\.goo\.gl)$/),
});

export async function updateChannelSettings(ctx: TenantContext, input: unknown) {
  const data = channelSettingsSchema.parse(input);
  await assertLocationAccess(ctx, data.locationId);
  const { locationId, googleReviewUrl, ...rest } = data;
  // Without any hours, takeaway/delivery would accept orders at any time of day and night
  // (audit GAP-04). Hours are entered by the restaurant, never assumed.
  const hours = await db.restaurantLocation.findUniqueOrThrow({ where: { id: locationId }, select: { openingHours: true, takeawaySettings: { select: { pickupHours: true } }, deliverySettings: { select: { deliveryHours: true } } } });
  if (rest.takeawayEnabled && !hours.openingHours && !hours.takeawaySettings?.pickupHours) throw new UserFacingError('Enter your opening hours (Settings) or pickup hours (Takeaway) before turning on takeaway.');
  if (rest.deliveryEnabled && !hours.openingHours && !hours.deliverySettings?.deliveryHours) throw new UserFacingError('Enter your opening hours (Settings) or delivery hours (Delivery) before turning on delivery.');
  await db.$transaction(async (tx) => {
    await tx.restaurantLocation.update({
      where: { id: locationId },
      data: {
        ...rest,
        glovoUrl: rest.glovoUrl ?? null,
        uberEatsUrl: rest.uberEatsUrl ?? null,
        websiteUrl: rest.websiteUrl ?? null,
        instagramUrl: rest.instagramUrl ?? null,
        facebookUrl: rest.facebookUrl ?? null,
        tiktokUrl: rest.tiktokUrl ?? null,
      },
    });
    await tx.reviewSettings.upsert({
      where: { locationId },
      update: { googleReviewUrl: googleReviewUrl ?? null },
      create: { locationId, googleReviewUrl: googleReviewUrl ?? null },
    });
    const org = await tx.restaurantOrganization.findUniqueOrThrow({ where: { id: ctx.org.id } });
    await tx.restaurantOrganization.update({
      where: { id: ctx.org.id },
      data: { onboardingData: { ...((org.onboardingData as object) ?? {}), channelsSaved: true } },
    });
    await audit({ organizationId: ctx.org.id, actorUserId: ctx.userId, action: 'settings.channels_updated', entityType: 'RestaurantLocation', entityId: locationId }, tx);
  });
}

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const brandingSchema = z.object({
  themePreset: z.enum(['classic', 'moroccan', 'minimal', 'bistro']),
  primaryColor: hex,
  accentColor: hex,
  backgroundColor: hex,
  textColor: hex,
  headingFont: z.enum(['serif', 'sans']),
  tagline: optText(140),
});

export const THEME_PRESETS: Record<string, { primaryColor: string; accentColor: string; backgroundColor: string; textColor: string; headingFont: 'serif' | 'sans' }> = {
  moroccan: { primaryColor: '#1F5C4A', accentColor: '#B8975A', backgroundColor: '#FBF7EE', textColor: '#1E2420', headingFont: 'serif' },
  classic: { primaryColor: '#2B2B2B', accentColor: '#C0392B', backgroundColor: '#FFFFFF', textColor: '#1A1A1A', headingFont: 'serif' },
  minimal: { primaryColor: '#171A1D', accentColor: '#6B7280', backgroundColor: '#FAFAFA', textColor: '#171A1D', headingFont: 'sans' },
  bistro: { primaryColor: '#7A2E1F', accentColor: '#D4A64A', backgroundColor: '#FFF8F0', textColor: '#2A1A14', headingFont: 'serif' },
};

const checked = (v: unknown) => v === 'on' || v === true || v === 'true';

/**
 * Saves branding. `files` are media paths already stored for THIS tenant (see saveBrandingWithImages);
 * image paths are never read from `input`. `removeLogo` / `removeCover` in `input` clear an image.
 * Replaced or removed images are deleted from storage after the change is committed.
 */
export async function updateBranding(ctx: TenantContext, input: unknown, files: { logo?: string; cover?: string } = {}) {
  const data = brandingSchema.parse(input);
  const flags = (input ?? {}) as Record<string, unknown>;
  const logoUrl = files.logo ?? (checked(flags.removeLogo) ? null : undefined);
  const coverUrl = files.cover ?? (checked(flags.removeCover) ? null : undefined);
  const previous = await db.$transaction(async (tx) => {
    // Serializes concurrent branding saves so a replaced image is always the one actually overwritten.
    await tx.$executeRaw`SELECT 1 FROM "RestaurantBranding" WHERE "organizationId" = ${ctx.org.id} FOR UPDATE`;
    const prev = await tx.restaurantBranding.findUnique({ where: { organizationId: ctx.org.id }, select: { logoUrl: true, coverUrl: true } });
    await tx.restaurantBranding.upsert({
      where: { organizationId: ctx.org.id },
      update: { ...data, tagline: data.tagline ?? null, ...(logoUrl !== undefined ? { logoUrl } : {}), ...(coverUrl !== undefined ? { coverUrl } : {}) },
      create: { organizationId: ctx.org.id, ...data, tagline: data.tagline ?? null, logoUrl: logoUrl ?? null, coverUrl: coverUrl ?? null },
    });
    const org = await tx.restaurantOrganization.findUniqueOrThrow({ where: { id: ctx.org.id } });
    await tx.restaurantOrganization.update({
      where: { id: ctx.org.id },
      data: { onboardingData: { ...((org.onboardingData as object) ?? {}), brandingSaved: true } },
    });
    const change = (next: string | null | undefined, old: string | null | undefined) => (next === undefined || next === old ? undefined : next === null ? 'removed' : old ? 'replaced' : 'added');
    await audit(
      {
        organizationId: ctx.org.id,
        actorUserId: ctx.userId,
        action: 'settings.branding_updated',
        entityType: 'RestaurantBranding',
        metadata: { logo: change(logoUrl, prev?.logoUrl) ?? null, cover: change(coverUrl, prev?.coverUrl) ?? null },
      },
      tx,
    );
    return prev;
  });
  await deleteTenantMedia(ctx.org.id, [
    logoUrl !== undefined && previous?.logoUrl !== logoUrl ? previous?.logoUrl : null,
    coverUrl !== undefined && previous?.coverUrl !== coverUrl ? previous?.coverUrl : null,
  ]);
}

/** Validates the form, stores new logo/cover files for this tenant, then saves (new files are removed again on failure). */
export async function saveBrandingWithImages(ctx: TenantContext, input: unknown, uploads: { logo?: unknown; cover?: unknown }) {
  brandingSchema.parse(input); // reject invalid input before storing anything
  const file = (v: unknown) => (v instanceof File && v.size > 0 ? { file: v, folder: 'branding' as const } : undefined);
  await withStoredImages(ctx.org.id, { logo: file(uploads.logo), cover: file(uploads.cover) }, (paths) => updateBranding(ctx, input, paths));
}

export async function markOnboardingFlag(ctx: TenantContext, flag: 'previewedAt' | 'translationsReviewedAt') {
  const org = await db.restaurantOrganization.findUniqueOrThrow({ where: { id: ctx.org.id } });
  await db.restaurantOrganization.update({
    where: { id: ctx.org.id },
    data: { onboardingData: { ...((org.onboardingData as object) ?? {}), [flag]: new Date().toISOString() } },
  });
}
