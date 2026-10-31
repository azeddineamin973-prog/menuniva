import 'server-only';
import { z } from 'zod';
import type { ImportSourceType, LanguageCode } from '@/generated/prisma/enums';
import { parseMoneyToCents } from '@/lib/money';
import { audit } from '../audit';
import { db } from '../db';
import { UserFacingError } from '../errors';
import type { TenantContext } from '../tenant';
import { pickName } from './menu';

/**
 * Turning imported platform prices into the restaurant's own dine-in prices.
 *
 * Background: the importer deliberately keeps Glovo/Uber Eats prices in `ExternalSourcePrice`
 * and never touches `ChannelPrice`, because a delivery-platform price is not what a restaurant
 * charges at its own table — it usually carries the platform's commission. That separation
 * stays. This module is the one place where an owner can say "yes, use those amounts as my
 * dine-in prices too", and it only ever runs from an explicit, confirmed click.
 *
 * Rules enforced here:
 * - Amounts are copied exactly, in integer cents. Nothing is rounded, marked up or converted.
 * - A row whose currency differs from the restaurant's is refused, not converted.
 * - An existing dine-in price is never replaced unless the owner asks for that explicitly.
 * - The reference price stays in `ExternalSourcePrice`; this copies, it does not move.
 * - Dishes stay drafts unless the owner separately asks to make them visible.
 */

export type VariantProposal = {
  id: string;
  name: string;
  currentDeltaCents: number;
  /** Size price difference recovered from the original import, or null when it is not available. */
  proposedDeltaCents: number | null;
};

export type ExternalPriceProposal = {
  productId: string;
  name: string;
  categoryName: string;
  status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
  currentDineInCents: number | null;
  externalCents: number;
  currency: string;
  provider: ImportSourceType;
  /** True when applying would replace a price the restaurant already set. */
  replaces: boolean;
  variants: VariantProposal[];
};

export type ExternalPriceReview = {
  providers: { provider: ImportSourceType; products: number; missingDineIn: number }[];
  provider: ImportSourceType | null;
  proposals: ExternalPriceProposal[];
  /** Rows that cannot be applied because their currency is not the restaurant's. */
  currencyMismatches: { name: string; currency: string }[];
  restaurantCurrency: string;
  /** Non-archived dishes with no dine-in price at all, including those with no imported price. */
  missingDineInTotal: number;
  /** Of those, how many this provider could fill. */
  fillable: number;
};

const PLATFORMS: ImportSourceType[] = ['GLOVO', 'UBER_EATS'];

/** Absolute size prices captured at import, used to restore "large costs €2 more". */
type ImportedVariant = { name?: unknown; priceCents?: unknown };

function importedVariantPrices(raw: unknown): Map<string, number> {
  const out = new Map<string, number>();
  if (!Array.isArray(raw)) return out;
  for (const v of raw as ImportedVariant[]) {
    if (!v || typeof v.name !== 'string' || typeof v.priceCents !== 'number' || !Number.isSafeInteger(v.priceCents)) continue;
    out.set(v.name.trim().toLowerCase(), v.priceCents);
  }
  return out;
}

/**
 * What applying the imported prices would do, dish by dish, so the owner reviews real numbers
 * before anything changes. Read-only.
 */
export async function externalPriceReview(ctx: TenantContext, provider?: ImportSourceType | null): Promise<ExternalPriceReview> {
  const org = await db.restaurantOrganization.findUniqueOrThrow({ where: { id: ctx.org.id }, select: { currency: true, sourceLanguage: true, enabledLanguages: true } });
  const langs: LanguageCode[] = [org.sourceLanguage, ...org.enabledLanguages];

  const withExternal = await db.menuProduct.findMany({
    where: { organizationId: ctx.org.id, status: { not: 'ARCHIVED' }, externalPrices: { some: {} } },
    include: {
      translations: { select: { language: true, name: true } },
      prices: { where: { channel: 'DINE_IN' } },
      externalPrices: true,
      variants: { orderBy: { sortOrder: 'asc' } },
      category: { include: { translations: { select: { language: true, name: true } } } },
    },
    orderBy: [{ categoryId: 'asc' }, { sortOrder: 'asc' }],
  });

  const providers = PLATFORMS.map((p) => {
    const rows = withExternal.filter((x) => x.externalPrices.some((e) => e.provider === p));
    return { provider: p, products: rows.length, missingDineIn: rows.filter((x) => x.prices.length === 0).length };
  }).filter((p) => p.products > 0);

  // Default to whichever platform can fill the most empty prices.
  const chosen = provider ?? providers.slice().sort((a, b) => b.missingDineIn - a.missingDineIn)[0]?.provider ?? null;
  const missingDineInTotal = await db.menuProduct.count({ where: { organizationId: ctx.org.id, status: { not: 'ARCHIVED' }, prices: { none: { channel: 'DINE_IN' } } } });
  if (!chosen) return { providers, provider: null, proposals: [], currencyMismatches: [], restaurantCurrency: org.currency, missingDineInTotal, fillable: 0 };

  const rows = withExternal.filter((p) => p.externalPrices.some((e) => e.provider === chosen));
  const externalIds = rows.map((p) => p.externalPrices.find((e) => e.provider === chosen)!.externalId).filter((v): v is string => !!v);
  // Size prices are only kept in the import records, because the importer stores platform
  // variant deltas as 0 (a platform surcharge is not ours to charge until the price is ours).
  const imported = externalIds.length
    ? await db.importedProduct.findMany({
        where: { externalId: { in: externalIds }, job: { organizationId: ctx.org.id }, source: { type: chosen } },
        select: { externalId: true, variants: true, priceCents: true, job: { select: { createdAt: true } } },
        orderBy: { job: { createdAt: 'desc' } },
      })
    : [];
  const importedByExternalId = new Map<string, (typeof imported)[number]>();
  for (const row of imported) if (row.externalId && !importedByExternalId.has(row.externalId)) importedByExternalId.set(row.externalId, row);

  const proposals: ExternalPriceProposal[] = [];
  const currencyMismatches: { name: string; currency: string }[] = [];
  for (const p of rows) {
    const ext = p.externalPrices.find((e) => e.provider === chosen)!;
    const name = pickName(p.translations, langs) ?? '(no name)';
    if (ext.currency !== org.currency) {
      currencyMismatches.push({ name, currency: ext.currency });
      continue;
    }
    const source = ext.externalId ? importedByExternalId.get(ext.externalId) : undefined;
    const sizePrices = importedVariantPrices(source?.variants);
    // Deltas are only proposed while every delta is still 0, i.e. nobody has priced the sizes
    // by hand. Otherwise the owner's own numbers stay.
    const untouched = p.variants.every((v) => v.priceDeltaCents === 0);
    proposals.push({
      productId: p.id,
      name,
      categoryName: pickName(p.category.translations, langs) ?? '—',
      status: p.status,
      currentDineInCents: p.prices[0]?.amountCents ?? null,
      externalCents: ext.amountCents,
      currency: ext.currency,
      provider: chosen,
      replaces: p.prices.length > 0,
      variants: p.variants.map((v) => {
        const absolute = sizePrices.get(String((v.names as Record<string, string>)[org.sourceLanguage] ?? '').trim().toLowerCase());
        return {
          id: v.id,
          name: String((v.names as Record<string, string>)[org.sourceLanguage] ?? Object.values((v.names ?? {}) as Record<string, string>)[0] ?? '—'),
          currentDeltaCents: v.priceDeltaCents,
          proposedDeltaCents: untouched && absolute !== undefined ? absolute - ext.amountCents : null,
        };
      }),
    });
  }
  return { providers, provider: chosen, proposals, currencyMismatches, restaurantCurrency: org.currency, missingDineInTotal, fillable: proposals.filter((p) => !p.replaces).length };
}

export const applyExternalPricesSchema = z.object({
  provider: z.enum(['GLOVO', 'UBER_EATS']),
  /** The owner states they reviewed the proposed amounts. Required: this changes what guests pay. */
  confirm: z.boolean(),
  /** Absent = every dish this provider can fill. Present = only these dishes. */
  productIds: z.array(z.string().min(1)).max(2000).optional(),
  /** Replace prices the restaurant already set. Off by default. */
  overwriteExisting: z.boolean().default(false),
  /** Also copy the size price differences recovered from the import. */
  applyVariants: z.boolean().default(true),
  /** Make the priced dishes visible to guests. Off by default: pricing is not publishing. */
  makeVisible: z.boolean().default(false),
});

export type ApplyExternalPricesResult = { updated: number; skipped: number; variantsUpdated: number; madeVisible: number };

/**
 * Copies imported platform prices into dine-in prices, in one transaction, after one explicit
 * confirmation. Returns exactly what changed.
 */
export async function applyExternalPrices(ctx: TenantContext, input: unknown): Promise<ApplyExternalPricesResult> {
  const d = applyExternalPricesSchema.parse(input);
  if (!d.confirm) throw new UserFacingError('Please confirm the prices you reviewed before applying them.');
  const review = await externalPriceReview(ctx, d.provider);
  const selected = d.productIds ? new Set(d.productIds) : null;
  const targets = review.proposals.filter((p) => (selected ? selected.has(p.productId) : true)).filter((p) => (p.replaces ? d.overwriteExisting : true));
  const skipped = review.proposals.length - targets.length;
  if (targets.length === 0) {
    throw new UserFacingError(
      review.proposals.length === 0
        ? 'There are no imported prices to copy.'
        : 'Every selected dish already has a dine-in price. Tick "replace prices I already set" if you want to overwrite them.',
    );
  }

  const result = await db.$transaction(
    async (tx) => {
      let updated = 0;
      let variantsUpdated = 0;
      let madeVisible = 0;
      for (const p of targets) {
        await tx.channelPrice.upsert({
          where: { productId_channel: { productId: p.productId, channel: 'DINE_IN' } },
          update: { amountCents: p.externalCents },
          create: { productId: p.productId, channel: 'DINE_IN', amountCents: p.externalCents },
        });
        updated++;
        if (d.applyVariants) {
          for (const v of p.variants) {
            if (v.proposedDeltaCents === null || v.proposedDeltaCents === v.currentDeltaCents) continue;
            await tx.productVariant.update({ where: { id: v.id }, data: { priceDeltaCents: v.proposedDeltaCents } });
            variantsUpdated++;
          }
        }
        // Visibility is a separate decision and keeps the same rule as everywhere else: a dish
        // needs a dine-in price, which it now has.
        if (d.makeVisible && p.status === 'DRAFT') {
          await tx.menuProduct.update({ where: { id: p.productId }, data: { status: 'ACTIVE' } });
          madeVisible++;
        }
      }
      const summary = { provider: d.provider, updated, skipped, variantsUpdated, madeVisible, overwriteExisting: d.overwriteExisting };
      await audit({ organizationId: ctx.org.id, actorUserId: ctx.userId, action: 'menu.prices_applied_from_import', entityType: 'Menu', metadata: summary }, tx);
      return { updated, skipped, variantsUpdated, madeVisible };
    },
    { timeout: 60_000 },
  );
  return result;
}

export const bulkPriceSchema = z.object({
  productIds: z.array(z.string().min(1)).min(1, 'Select at least one dish.').max(2000),
  channel: z.enum(['DINE_IN', 'TAKEAWAY', 'DELIVERY']),
  price: z.string().trim().min(1, 'Enter a price.'),
});

/**
 * Sets the same price on several dishes at once (e.g. all teas cost €2,50). Uses the same
 * money parsing and the same ceiling as the single-dish editor.
 */
export async function setPricesInBulk(ctx: TenantContext, input: unknown): Promise<{ updated: number }> {
  const d = bulkPriceSchema.parse(input);
  const cents = parseMoneyToCents(d.price);
  if (cents === null) throw new UserFacingError('Invalid price. Use a format like 12,50.');
  if (cents > 100_000_00) throw new UserFacingError('Price is too high.');
  // Tenant scoping comes from the session, never from the form.
  const owned = await db.menuProduct.findMany({ where: { id: { in: d.productIds }, organizationId: ctx.org.id, status: { not: 'ARCHIVED' } }, select: { id: true } });
  if (owned.length === 0) throw new UserFacingError('No dishes found.', 404);
  await db.$transaction(
    owned.map((p) =>
      db.channelPrice.upsert({
        where: { productId_channel: { productId: p.id, channel: d.channel } },
        update: { amountCents: cents },
        create: { productId: p.id, channel: d.channel, amountCents: cents },
      }),
    ),
  );
  await audit({ organizationId: ctx.org.id, actorUserId: ctx.userId, action: 'menu.prices_bulk_set', entityType: 'Menu', metadata: { channel: d.channel, cents, count: owned.length } });
  return { updated: owned.length };
}
