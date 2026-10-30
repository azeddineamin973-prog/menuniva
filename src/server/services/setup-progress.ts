import 'server-only';
import { db } from '../db';

export type SetupStep = {
  n: number;
  key: string;
  title: string;
  description: string;
  done: boolean;
  path: string; // dashboard sub-path where the step is completed
};

type OnboardingData = { brandingSaved?: boolean; channelsSaved?: boolean; previewedAt?: string; translationsReviewedAt?: string };

/**
 * The 10-step onboarding wizard (Part 23). Completion is derived from real database state,
 * so progress is never claimed for work that has not been done.
 */
export async function getSetupProgress(organizationId: string): Promise<{ steps: SetupStep[]; completed: number; locationId: string | null }> {
  const org = await db.restaurantOrganization.findUniqueOrThrow({
    where: { id: organizationId },
    include: { branding: true, locations: { orderBy: { createdAt: 'asc' }, take: 1 } },
  });
  const location = org.locations[0] ?? null;
  const data = (org.onboardingData ?? {}) as OnboardingData;
  const productWhere = { organizationId, status: { not: 'ARCHIVED' as const } };

  const [productCount, missingDineIn, tableCount, stationCount, unroutedProducts, missingTranslations] = await Promise.all([
    db.menuProduct.count({ where: productWhere }),
    db.menuProduct.count({ where: { ...productWhere, prices: { none: { channel: 'DINE_IN' } } } }),
    location ? db.restaurantTable.count({ where: { locationId: location.id, isActive: true } }) : 0,
    location ? db.kitchenStation.count({ where: { locationId: location.id, isActive: true } }) : 0,
    db.menuProduct.count({ where: { ...productWhere, stationId: null, category: { defaultStationId: null } } }),
    countMissingTranslations(organizationId, org.enabledLanguages),
  ]);

  const detailsDone = !!(location?.addressLine1 && location.postalCode && location.city && (location.phone || location.whatsappNumber));
  const channelsDone = !!data.channelsSaved && !!location && (location.tableOrderingEnabled || location.takeawayEnabled || location.deliveryEnabled);

  const steps: SetupStep[] = [
    { n: 1, key: 'details', title: 'Restaurant details', description: 'Address, phone, country, languages and opening hours.', done: detailsDone, path: '/settings' },
    { n: 2, key: 'branding', title: 'Branding', description: 'Logo, cover photo, colours and style of your customer menu.', done: !!(org.branding?.logoUrl || data.brandingSaved), path: '/settings/branding' },
    { n: 3, key: 'import', title: 'Import or create your menu', description: 'Import from a file or add categories and dishes manually.', done: productCount > 0, path: '/menu' },
    { n: 4, key: 'translations', title: 'Review translations', description: 'Check every enabled language before guests see it.', done: productCount > 0 && missingTranslations === 0 && !!data.translationsReviewedAt, path: '/menu/translations' },
    { n: 5, key: 'prices', title: 'Prices and availability', description: 'Set dine-in, takeaway and delivery prices.', done: productCount > 0 && missingDineIn === 0, path: '/menu' },
    { n: 6, key: 'tables', title: 'Tables and QR codes', description: 'Create dining areas and tables, then print QR codes.', done: tableCount > 0, path: '/tables' },
    { n: 7, key: 'channels', title: 'Ordering channels', description: 'Table ordering, takeaway, delivery and external links.', done: channelsDone, path: '/settings/channels' },
    { n: 8, key: 'kitchen', title: 'Kitchen stations', description: 'Create stations and route each dish to the right one.', done: stationCount > 0 && productCount > 0 && unroutedProducts === 0, path: '/stations' },
    { n: 9, key: 'preview', title: 'Preview customer menu', description: 'See exactly what guests will see on their phones.', done: !!data.previewedAt, path: '/setup/preview' },
    { n: 10, key: 'publish', title: 'Publish', description: 'Make your menu and ordering live.', done: !!location?.isPublished, path: '/setup/publish' },
  ];
  return { steps, completed: steps.filter((s) => s.done).length, locationId: location?.id ?? null };
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
