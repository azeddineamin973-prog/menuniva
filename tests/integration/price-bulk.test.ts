import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/server/db';
import { applyExternalPrices, externalPriceReview, setPricesInBulk } from '@/server/services/price-bulk';
import { getSetupProgress } from '@/server/services/setup-progress';
import { resetDatabase } from '../support/db';
import { createOrderingFixture } from '../support/fixtures';

type F = Awaited<ReturnType<typeof createOrderingFixture>>;

/** An imported Glovo dish: a draft with a reference price and no dine-in price of its own. */
async function importedDish(f: F, name: string, glovoCents: number, opts: { externalId?: string; sizes?: { name: string; priceCents: number }[]; currency?: string } = {}) {
  const menu = await db.menu.findFirstOrThrow({ where: { organizationId: f.org.id } });
  const category = await db.menuCategory.findFirstOrThrow({ where: { organizationId: f.org.id } });
  const externalId = opts.externalId ?? `ext-${name}`;
  const product = await db.menuProduct.create({
    data: {
      organizationId: f.org.id,
      menuId: menu.id,
      categoryId: category.id,
      status: 'DRAFT',
      origin: 'IMPORTED',
      translations: { create: { language: 'pt', name, status: 'SOURCE' } },
      externalPrices: { create: { provider: 'GLOVO', amountCents: glovoCents, externalId, currency: opts.currency ?? 'EUR' } },
      // The importer stores platform size prices as a zero delta: a platform surcharge is not
      // ours to charge until the price is ours.
      variants: opts.sizes?.length ? { create: opts.sizes.map((s, i) => ({ names: { pt: s.name }, priceDeltaCents: 0, isDefault: i === 0, sortOrder: i })) } : undefined,
    },
  });
  if (opts.sizes?.length) {
    // The absolute size prices survive in the import record, which is where they are recovered from.
    const job = await db.importJob.create({ data: { organizationId: f.org.id, status: 'PUBLISHED', createdById: f.owner.id, sourceLanguage: 'pt' } });
    const source = await db.importSource.create({ data: { jobId: job.id, type: 'GLOVO', status: 'PARSED' } });
    await db.importedProduct.create({ data: { jobId: job.id, sourceId: source.id, name, externalId, priceCents: glovoCents, variants: opts.sizes } });
  }
  return product;
}

describe('using imported platform prices as dine-in prices', () => {
  beforeEach(resetDatabase);

  it('shows the exact amounts that would be used before anything changes', async () => {
    const f = await createOrderingFixture();
    await importedDish(f, 'Tajine', 1490);
    const review = await externalPriceReview(f.ctx);
    expect(review.provider).toBe('GLOVO');
    expect(review.providers).toEqual([{ provider: 'GLOVO', products: 1, missingDineIn: 1 }]);
    expect(review.proposals).toHaveLength(1);
    expect(review.proposals[0]).toMatchObject({ name: 'Tajine', currentDineInCents: null, externalCents: 1490, replaces: false });
    // Reviewing changes nothing.
    expect(await db.channelPrice.count({ where: { product: { origin: 'IMPORTED' } } })).toBe(0);
  });

  it('copies the amount exactly, in cents, and keeps the reference price', async () => {
    const f = await createOrderingFixture();
    const p = await importedDish(f, 'Tajine', 1490);
    const res = await applyExternalPrices(f.ctx, { provider: 'GLOVO', confirm: true });
    expect(res).toMatchObject({ updated: 1, skipped: 0 });
    const price = await db.channelPrice.findUniqueOrThrow({ where: { productId_channel: { productId: p.id, channel: 'DINE_IN' } } });
    expect(price.amountCents).toBe(1490); // no rounding, no mark-up
    // The Glovo price is still recorded separately, as a reference.
    const ext = await db.externalSourcePrice.findFirstOrThrow({ where: { productId: p.id } });
    expect(ext).toMatchObject({ provider: 'GLOVO', amountCents: 1490, currency: 'EUR' });
  });

  it('refuses to run without an explicit confirmation', async () => {
    const f = await createOrderingFixture();
    await importedDish(f, 'Tajine', 1490);
    await expect(applyExternalPrices(f.ctx, { provider: 'GLOVO', confirm: false })).rejects.toThrow(/confirm the prices/);
    expect(await db.channelPrice.count({ where: { product: { origin: 'IMPORTED' } } })).toBe(0);
  });

  it('never replaces a price the restaurant already set, unless that is asked for', async () => {
    const f = await createOrderingFixture();
    const p = await importedDish(f, 'Tajine', 1490);
    await db.channelPrice.create({ data: { productId: p.id, channel: 'DINE_IN', amountCents: 1200 } });

    const review = await externalPriceReview(f.ctx, 'GLOVO');
    expect(review.proposals[0]).toMatchObject({ currentDineInCents: 1200, replaces: true });
    await expect(applyExternalPrices(f.ctx, { provider: 'GLOVO', confirm: true })).rejects.toThrow(/already has a dine-in price/);
    expect((await db.channelPrice.findFirstOrThrow({ where: { productId: p.id } })).amountCents).toBe(1200);

    const res = await applyExternalPrices(f.ctx, { provider: 'GLOVO', confirm: true, overwriteExisting: true });
    expect(res.updated).toBe(1);
    expect((await db.channelPrice.findFirstOrThrow({ where: { productId: p.id } })).amountCents).toBe(1490);
  });

  it('fills the empty prices and leaves the already-priced dishes alone', async () => {
    const f = await createOrderingFixture();
    const empty = await importedDish(f, 'Tajine', 1490);
    const priced = await importedDish(f, 'Pastilla', 1600);
    await db.channelPrice.create({ data: { productId: priced.id, channel: 'DINE_IN', amountCents: 1300 } });

    const res = await applyExternalPrices(f.ctx, { provider: 'GLOVO', confirm: true });
    expect(res).toMatchObject({ updated: 1, skipped: 1 });
    expect((await db.channelPrice.findFirstOrThrow({ where: { productId: empty.id } })).amountCents).toBe(1490);
    expect((await db.channelPrice.findFirstOrThrow({ where: { productId: priced.id } })).amountCents).toBe(1300);
  });

  it('restores the size differences from the original import', async () => {
    const f = await createOrderingFixture();
    const p = await importedDish(f, 'Tajine', 1490, { sizes: [{ name: 'Individual', priceCents: 1490 }, { name: 'Para dois', priceCents: 2290 }] });
    const review = await externalPriceReview(f.ctx, 'GLOVO');
    expect(review.proposals[0].variants.map((v) => [v.name, v.currentDeltaCents, v.proposedDeltaCents])).toEqual([
      ['Individual', 0, 0],
      ['Para dois', 0, 800], // 22,90 − 14,90
    ]);
    const res = await applyExternalPrices(f.ctx, { provider: 'GLOVO', confirm: true });
    expect(res.variantsUpdated).toBe(1);
    const variants = await db.productVariant.findMany({ where: { productId: p.id }, orderBy: { sortOrder: 'asc' } });
    expect(variants.map((v) => v.priceDeltaCents)).toEqual([0, 800]);
  });

  it('leaves size prices the owner set themselves alone', async () => {
    const f = await createOrderingFixture();
    const p = await importedDish(f, 'Tajine', 1490, { sizes: [{ name: 'Individual', priceCents: 1490 }, { name: 'Para dois', priceCents: 2290 }] });
    const big = await db.productVariant.findFirstOrThrow({ where: { productId: p.id, sortOrder: 1 } });
    await db.productVariant.update({ where: { id: big.id }, data: { priceDeltaCents: 500 } }); // owner's own number

    const review = await externalPriceReview(f.ctx, 'GLOVO');
    expect(review.proposals[0].variants.every((v) => v.proposedDeltaCents === null)).toBe(true);
    const res = await applyExternalPrices(f.ctx, { provider: 'GLOVO', confirm: true });
    expect(res.variantsUpdated).toBe(0);
    expect((await db.productVariant.findUniqueOrThrow({ where: { id: big.id } })).priceDeltaCents).toBe(500);
  });

  it('refuses a price in another currency instead of converting it', async () => {
    const f = await createOrderingFixture();
    await importedDish(f, 'Tajine', 1490, { currency: 'GBP' });
    const review = await externalPriceReview(f.ctx, 'GLOVO');
    expect(review.proposals).toHaveLength(0);
    expect(review.currencyMismatches).toEqual([{ name: 'Tajine', currency: 'GBP' }]);
    await expect(applyExternalPrices(f.ctx, { provider: 'GLOVO', confirm: true })).rejects.toThrow(/no imported prices/);
  });

  it('prices a dish without publishing it, unless publishing is asked for', async () => {
    const f = await createOrderingFixture();
    const p = await importedDish(f, 'Tajine', 1490);
    await applyExternalPrices(f.ctx, { provider: 'GLOVO', confirm: true });
    expect((await db.menuProduct.findUniqueOrThrow({ where: { id: p.id } })).status).toBe('DRAFT');

    const q = await importedDish(f, 'Pastilla', 1600);
    const res = await applyExternalPrices(f.ctx, { provider: 'GLOVO', confirm: true, makeVisible: true });
    expect(res.madeVisible).toBe(1);
    expect((await db.menuProduct.findUniqueOrThrow({ where: { id: q.id } })).status).toBe('ACTIVE');
  });

  it('applies only the dishes that were ticked', async () => {
    const f = await createOrderingFixture();
    const a = await importedDish(f, 'Tajine', 1490);
    const b = await importedDish(f, 'Pastilla', 1600);
    await applyExternalPrices(f.ctx, { provider: 'GLOVO', confirm: true, productIds: [a.id] });
    expect(await db.channelPrice.count({ where: { productId: a.id } })).toBe(1);
    expect(await db.channelPrice.count({ where: { productId: b.id } })).toBe(0);
  });

  it('closes the prices setup step once nothing is unpriced', async () => {
    const f = await createOrderingFixture();
    await importedDish(f, 'Tajine', 1490);
    const step = () => getSetupProgress(f.org.id).then((p) => p.steps.find((s) => s.key === 'prices')!);
    expect((await step()).done).toBe(false);
    // The step points the owner at the one-step fix rather than at 73 dishes.
    expect((await step()).missing.join(' ')).toMatch(/imported Glovo price you can copy/);
    await applyExternalPrices(f.ctx, { provider: 'GLOVO', confirm: true });
    expect((await step()).done).toBe(true);
  });

  it('cannot touch another restaurant\'s dishes', async () => {
    const a = await createOrderingFixture('Test Restaurant A');
    const b = await createOrderingFixture('Test Restaurant B');
    const theirs = await importedDish(b, 'Tajine', 1490);
    await expect(applyExternalPrices(a.ctx, { provider: 'GLOVO', confirm: true, productIds: [theirs.id] })).rejects.toThrow();
    expect(await db.channelPrice.count({ where: { productId: theirs.id } })).toBe(0);
  });
});

describe('setting one price on several dishes', () => {
  beforeEach(resetDatabase);

  it('applies the same amount to every chosen dish', async () => {
    const f = await createOrderingFixture();
    const res = await setPricesInBulk(f.ctx, { productIds: [f.dish.id, f.tea.id], channel: 'DINE_IN', price: '2,50' });
    expect(res.updated).toBe(2);
    const prices = await db.channelPrice.findMany({ where: { productId: { in: [f.dish.id, f.tea.id] }, channel: 'DINE_IN' } });
    expect(prices.map((p) => p.amountCents)).toEqual([250, 250]);
  });

  it('rejects an ambiguous or impossible amount and changes nothing', async () => {
    const f = await createOrderingFixture();
    await expect(setPricesInBulk(f.ctx, { productIds: [f.dish.id], channel: 'DINE_IN', price: '16,999' })).rejects.toThrow(/Invalid price/);
    await expect(setPricesInBulk(f.ctx, { productIds: [f.dish.id], channel: 'DINE_IN', price: '999999,00' })).rejects.toThrow(/too high/);
    expect((await db.channelPrice.findFirstOrThrow({ where: { productId: f.dish.id, channel: 'DINE_IN' } })).amountCents).toBe(1690);
  });

  it('ignores ids that belong to someone else', async () => {
    const a = await createOrderingFixture('Test Restaurant A');
    const b = await createOrderingFixture('Test Restaurant B');
    const res = await setPricesInBulk(a.ctx, { productIds: [a.dish.id, b.dish.id], channel: 'TAKEAWAY', price: '5,00' });
    expect(res.updated).toBe(1);
    expect((await db.channelPrice.findFirstOrThrow({ where: { productId: b.dish.id, channel: 'TAKEAWAY' } })).amountCents).toBe(1590);
  });
});
