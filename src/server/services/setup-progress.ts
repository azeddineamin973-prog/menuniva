import 'server-only';
import { cache } from 'react';
import { db } from '../db';
import { countUnrouted } from './routing';

export type SetupStep = {
  n: number;
  key: SetupStepKey;
  title: string;
  description: string;
  done: boolean;
  path: string; // dashboard sub-path where the step is completed
  /**
   * What is actually still missing, in the owner's words. Empty when the step is done.
   * The wizard shows these instead of asking the owner to open each page to find out.
   */
  missing: string[];
  /** False for steps that cannot apply yet (e.g. routing dishes before any dish exists). */
  actionable: boolean;
};

export const SETUP_STEP_KEYS = ['details', 'branding', 'import', 'translations', 'prices', 'tables', 'channels', 'kitchen', 'preview', 'publish'] as const;
export type SetupStepKey = (typeof SETUP_STEP_KEYS)[number];

type OnboardingData = { brandingSaved?: boolean; channelsSaved?: boolean; previewedAt?: string; translationsReviewedAt?: string };

export type SetupProgress = { steps: SetupStep[]; completed: number; locationId: string | null };

/**
 * The 10-step onboarding wizard (Part 23). Completion is derived from real database state, so
 * progress is never claimed for work that has not been done.
 *
 * `locationId` picks which location the location-scoped steps (tables, stations, channels,
 * publish) are judged against. Without it the first location is used. The wizard passes the
 * location the owner currently has selected, so a second location's tables and publishing
 * register instead of leaving the checklist stuck on the first one.
 */
/** Memoized per page render: the sidebar card, the step bar and the setup page share one computation. */
export const getSetupProgress = cache((organizationId: string, locationId?: string | null): Promise<SetupProgress> => computeSetupProgress(organizationId, locationId ?? null));

async function computeSetupProgress(organizationId: string, locationId: string | null): Promise<SetupProgress> {
  const org = await db.restaurantOrganization.findUniqueOrThrow({
    where: { id: organizationId },
    include: { branding: true, locations: { orderBy: { createdAt: 'asc' } } },
  });
  const location = (locationId ? org.locations.find((l) => l.id === locationId) : null) ?? org.locations[0] ?? null;
  const data = (org.onboardingData ?? {}) as OnboardingData;
  const productWhere = { organizationId, status: { not: 'ARCHIVED' as const } };
  const targetLanguages = org.enabledLanguages.filter((l) => l !== org.sourceLanguage);

  const [productCount, missingDineIn, externalPriced, tableCount, stationCount, unroutedProducts, translations] = await Promise.all([
    db.menuProduct.count({ where: productWhere }),
    db.menuProduct.count({ where: { ...productWhere, prices: { none: { channel: 'DINE_IN' } } } }),
    // Dishes that already carry an imported platform price: those are one click away from priced.
    db.menuProduct.count({ where: { ...productWhere, prices: { none: { channel: 'DINE_IN' } }, externalPrices: { some: {} } } }),
    location ? db.restaurantTable.count({ where: { locationId: location.id, isActive: true } }) : 0,
    location ? db.kitchenStation.count({ where: { locationId: location.id, isActive: true } }) : 0,
    countUnrouted(organizationId),
    translationCounts(organizationId, targetLanguages),
  ]);

  const detailsMissing: string[] = [];
  if (!location) detailsMissing.push('Add a location.');
  else {
    if (!location.addressLine1) detailsMissing.push('Street address is missing.');
    if (!location.postalCode) detailsMissing.push('Postal code is missing.');
    if (!location.city) detailsMissing.push('City is missing.');
    if (!location.phone && !location.whatsappNumber) detailsMissing.push('Add a phone or WhatsApp number.');
    if (!location.openingHours) detailsMissing.push('Opening hours are not set (needed for takeaway and delivery).');
  }
  // Opening hours are advisory here: the address, postal code, city and a contact number are
  // what publishing actually blocks on, so the step does not stay red for hours alone.
  const detailsDone = !!(location?.addressLine1 && location.postalCode && location.city && (location.phone || location.whatsappNumber));

  const channelsOn = !!location && (location.tableOrderingEnabled || location.takeawayEnabled || location.deliveryEnabled);
  const channelsDone = !!data.channelsSaved && channelsOn;

  const brandingDone = !!(org.branding?.logoUrl || data.brandingSaved);
  const pricesDone = productCount > 0 && missingDineIn === 0;
  const translationsDone = productCount > 0 && translations.missing === 0 && translations.unreviewed === 0 && !!data.translationsReviewedAt;
  const kitchenDone = stationCount > 0 && productCount > 0 && unroutedProducts === 0;

  const steps: SetupStep[] = [
    {
      n: 1,
      key: 'details',
      title: 'Restaurant details',
      description: 'Address, phone, country, languages and opening hours.',
      done: detailsDone,
      path: '/settings',
      missing: detailsDone ? detailsMissing.filter((t) => t.startsWith('Opening hours')) : detailsMissing,
      actionable: true,
    },
    {
      n: 2,
      key: 'branding',
      title: 'Branding',
      description: 'Logo, cover photo, colours and style of your customer menu.',
      done: brandingDone,
      path: '/settings/branding',
      missing: brandingDone ? [] : ['Choose your colours and upload a logo.'],
      actionable: true,
    },
    {
      n: 3,
      key: 'import',
      title: 'Import or create your menu',
      description: 'Import from your Glovo link or a file, or add dishes by hand.',
      done: productCount > 0,
      path: '/menu',
      missing: productCount > 0 ? [] : ['No dishes yet. Paste your Glovo link in the Import Studio, or add a dish by hand.'],
      actionable: true,
    },
    {
      n: 4,
      key: 'translations',
      title: 'Review translations',
      description: 'Check every enabled language before guests see it.',
      done: translationsDone,
      path: '/menu/translations',
      missing: translationStepMissing(productCount, translations, !!data.translationsReviewedAt, targetLanguages.length),
      actionable: productCount > 0 && targetLanguages.length > 0,
    },
    {
      n: 5,
      key: 'prices',
      title: 'Prices and availability',
      description: 'Set dine-in, takeaway and delivery prices.',
      done: pricesDone,
      path: '/menu/quick',
      missing: pricesStepMissing(productCount, missingDineIn, externalPriced),
      actionable: productCount > 0,
    },
    {
      n: 6,
      key: 'tables',
      title: 'Tables and QR codes',
      description: 'Create dining areas and tables, then print QR codes.',
      done: tableCount > 0,
      path: '/tables',
      missing: tableCount > 0 ? [] : ['No tables yet. Add them in one go, for example "1-12".'],
      actionable: true,
    },
    {
      n: 7,
      key: 'channels',
      title: 'Ordering channels',
      description: 'Table ordering, takeaway, delivery and external links.',
      done: channelsDone,
      path: '/settings/channels',
      missing: channelsDone ? [] : channelsOn ? ['Open the channels page once to confirm your choices.'] : ['Turn on at least one way to order: at the table, pickup or delivery.'],
      actionable: true,
    },
    {
      n: 8,
      key: 'kitchen',
      title: 'Kitchen stations',
      description: 'Create stations and route each dish to the right one.',
      done: kitchenDone,
      path: '/stations',
      missing: kitchenStepMissing(productCount, stationCount, unroutedProducts),
      actionable: productCount > 0,
    },
    {
      n: 9,
      key: 'preview',
      title: 'Preview customer menu',
      description: 'See exactly what guests will see on their phones.',
      done: !!data.previewedAt,
      path: '/setup/preview',
      missing: data.previewedAt ? [] : ['Take a look at your menu as a guest sees it.'],
      actionable: true,
    },
    {
      n: 10,
      key: 'publish',
      title: 'Publish',
      description: 'Make your menu and ordering live.',
      done: !!location?.isPublished,
      path: '/setup/publish',
      missing: location?.isPublished ? [] : ['Your restaurant is not live yet.'],
      actionable: true,
    },
  ];
  return { steps, completed: steps.filter((s) => s.done).length, locationId: location?.id ?? null };
}

function translationStepMissing(productCount: number, t: TranslationCounts, reviewed: boolean, targets: number): string[] {
  if (productCount === 0) return ['Add your menu first.'];
  if (targets === 0) return [];
  const out: string[] = [];
  if (t.missing > 0) out.push(`${t.missing} translations are missing. "Translate all with AI" fills them in one go.`);
  if (t.unreviewed > 0) out.push(`${t.unreviewed} machine translations are waiting for your approval — guests still see the original text.`);
  if (t.missing === 0 && t.unreviewed === 0 && !reviewed) out.push('Confirm you checked the translations.');
  return out;
}

function pricesStepMissing(productCount: number, missingDineIn: number, externalPriced: number): string[] {
  if (productCount === 0) return ['Add your menu first.'];
  if (missingDineIn === 0) return [];
  const out = [`${missingDineIn} dishes have no dine-in price.`];
  if (externalPriced > 0) out.push(`${externalPriced} of them have an imported Glovo price you can copy in one step.`);
  return out;
}

function kitchenStepMissing(productCount: number, stationCount: number, unrouted: number): string[] {
  if (productCount === 0) return ['Add your menu first.'];
  const out: string[] = [];
  if (stationCount === 0) out.push('No stations yet. Create the ones you use, for example Kitchen and Café.');
  else if (unrouted > 0) out.push(`${unrouted} dishes reach no kitchen screen. Assign a station per category in one step.`);
  return out;
}

type TranslationCounts = { missing: number; unreviewed: number };

/**
 * Translation work left, counted per (row, language) pair. The source language is excluded:
 * a dish with no source name is a menu problem, not a translation one.
 */
export async function translationCounts(organizationId: string, targetLanguages: string[]): Promise<TranslationCounts> {
  if (targetLanguages.length === 0) return { missing: 0, unreviewed: 0 };
  const [products, categories] = await Promise.all([
    db.menuProduct.findMany({ where: { organizationId, status: { not: 'ARCHIVED' } }, select: { translations: { select: { language: true, status: true } } } }),
    db.menuCategory.findMany({ where: { organizationId, isActive: true }, select: { translations: { select: { language: true, status: true } } } }),
  ]);
  let missing = 0;
  let unreviewed = 0;
  for (const row of [...products, ...categories]) {
    const byLang = new Map(row.translations.map((t) => [String(t.language), t.status]));
    for (const l of targetLanguages) {
      const status = byLang.get(l);
      if (!status) missing++;
      else if (status === 'MACHINE') unreviewed++;
    }
  }
  return { missing, unreviewed };
}

/** Active categories/products lacking a translation row for an enabled language. */
export async function countMissingTranslations(organizationId: string, languages: string[]): Promise<number> {
  const [products, categories] = await Promise.all([
    db.menuProduct.findMany({ where: { organizationId, status: { not: 'ARCHIVED' } }, select: { translations: { select: { language: true } } } }),
    db.menuCategory.findMany({ where: { organizationId, isActive: true }, select: { translations: { select: { language: true } } } }),
  ]);
  let missing = 0;
  for (const row of [...products, ...categories]) {
    const have = new Set(row.translations.map((t) => t.language));
    for (const l of languages) if (!have.has(l as never)) missing++;
  }
  return missing;
}

export type SetupNav = { step: SetupStep; index: number; total: number; prev: SetupStep | null; next: SetupStep | null; completed: number };

/**
 * Where a step page sits in the wizard, so every step page can offer "back to setup" and
 * "next step" instead of leaving the owner to find their way back.
 */
export function setupNav(progress: SetupProgress, key: SetupStepKey): SetupNav | null {
  const index = progress.steps.findIndex((s) => s.key === key);
  if (index === -1) return null;
  return {
    step: progress.steps[index],
    index,
    total: progress.steps.length,
    prev: progress.steps[index - 1] ?? null,
    next: progress.steps[index + 1] ?? null,
    completed: progress.completed,
  };
}
