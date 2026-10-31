import { beforeEach, describe, expect, it } from 'vitest';
import { GLOVO_CAPTURE_SOURCE } from '@/lib/glovo-capture';
import { db } from '@/server/db';
import {
  addImportSource,
  copyImportedImages,
  createImportJob,
  getImportPreview,
  publishImport,
  updateImportedProduct,
} from '@/server/import/service';
import { getPublicMenu } from '@/server/services/public-menu';
import { mediaKeyFromPath, storage } from '@/server/storage';
import { resetDatabase } from '../support/db';
import { createOrderingFixture } from '../support/fixtures';

/**
 * End-to-end Glovo import against a disposable test tenant ("Test Restaurant …") in the test
 * database. No real restaurant data is touched: `resetDatabase` refuses to run against any
 * database whose name is not `menuniva_test`.
 */

/** A capture as produced in the owner's browser, for a fictitious test restaurant. */
const CAPTURE = JSON.stringify({
  source: GLOVO_CAPTURE_SOURCE,
  version: 1,
  url: 'https://glovoapp.com/en/pt/braga/stores/test-restaurant',
  capturedAt: '2026-10-30T12:00:00.000Z',
  collections: [
    {
      title: 'Entradas de teste',
      products: [
        { name: 'Harira de teste', description: 'Sopa de lentilhas de teste', price: '6,50 €', imageUrl: 'https://images.glovoapp.com/harira-teste.jpg' },
        { name: 'Pastéis de teste', price: '5,00 €', soldOut: true },
      ],
    },
    {
      title: 'Tajines de teste',
      products: [
        {
          name: 'Tajine especial de teste',
          description: 'Com ameixas de teste',
          price: '14,90 €',
          attributeGroups: [
            { name: 'Tamanho de teste', minSelect: 1, maxSelect: 1, attributes: [{ name: 'Individual', priceImpact: 0 }, { name: 'Para dois', priceImpact: 8 }] },
            { name: 'Extras de teste', minSelect: 0, maxSelect: 2, attributes: [{ name: 'Pão de teste', priceImpact: 1.2 }, { name: 'Harissa de teste', priceImpact: 0.5 }] },
          ],
        },
      ],
    },
  ],
  raw: [],
});

/** Sends every category that still needs a station to the test kitchen, as an owner would. */
async function toKitchen(f: Awaited<ReturnType<typeof createOrderingFixture>>, jobId: string) {
  const p = await getImportPreview(f.ctx, jobId);
  return Object.fromEntries(p.stationTargets.map((t) => [t.label, f.kitchen.id]));
}

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489', 'hex');

describe('Glovo menu import', () => {
  beforeEach(resetDatabase);

  it('paste capture → review → publish: drafts only, Glovo prices kept apart, sizes and extras created', async () => {
    const f = await createOrderingFixture();
    const before = await db.menuProduct.count({ where: { organizationId: f.org.id } });
    const job = await createImportJob(f.ctx);

    const added = await addImportSource(f.ctx, job.id, { type: 'GLOVO', url: 'https://glovoapp.com/en/pt/braga/stores/test-restaurant', text: CAPTURE });
    expect(added).toMatchObject({ status: 'PARSED', items: 3 });
    // Nothing reaches the menu before the owner publishes.
    expect(await db.menuProduct.count({ where: { organizationId: f.org.id } })).toBe(before);

    const preview = await getImportPreview(f.ctx, job.id);
    expect(preview.job.status).toBe('NEEDS_REVIEW');
    expect(preview.summary).toMatchObject({ items: 3, categories: 2, withSizes: 1, withExtras: 1, extraGroups: 1, soldOut: 1, images: 1 });
    expect(preview.summary.after.newCategories).toEqual(['Entradas de teste', 'Tajines de teste']);
    expect(preview.glovoUrl).toBeNull(); // the fixture has no Glovo link saved yet
    expect(preview.sources[0]).toMatchObject({ type: 'GLOVO', status: 'PARSED', connectionStatus: 'LIMITED', url: 'https://glovoapp.com/en/pt/braga/stores/test-restaurant' });

    const res = await publishImport(f.ctx, job.id, { confirm: true, makeVisible: true, stations: await toKitchen(f, job.id) });
    // makeVisible was requested, but a platform price is never an in-house price, so every
    // imported dish stays a draft until the owner sets their own price.
    expect(res).toMatchObject({ created: 3, visible: 0, drafts: 3, modifierGroups: 1 });

    const tajine = await db.menuProduct.findFirstOrThrow({
      where: { organizationId: f.org.id, translations: { some: { name: 'Tajine especial de teste' } } },
      include: { prices: true, externalPrices: true, variants: true, modifierGroups: { include: { options: true } }, category: { include: { translations: true } } },
    });
    expect(tajine.status).toBe('DRAFT');
    expect(tajine.origin).toBe('IMPORTED');
    expect(tajine.prices).toEqual([]); // no dine-in price from a platform source
    expect(tajine.externalPrices.map((e) => [e.provider, e.amountCents])).toEqual([['GLOVO', 1490]]);
    expect(tajine.category.translations[0].name).toBe('Tajines de teste');
    expect(tajine.variants.map((v) => [(v.names as Record<string, string>).pt, v.priceDeltaCents, v.isDefault])).toEqual([
      ['Individual', 0, true],
      ['Para dois', 0, false], // a platform surcharge is never charged as ours
    ]);
    expect(tajine.modifierGroups).toHaveLength(1);
    expect(tajine.modifierGroups[0]).toMatchObject({ minSelect: 0, maxSelect: 2 });
    expect((tajine.modifierGroups[0].names as Record<string, string>).pt).toBe('Extras de teste');
    expect(tajine.modifierGroups[0].options.map((o) => [(o.names as Record<string, string>).pt, o.priceDeltaCents])).toEqual([
      ['Pão de teste', 0],
      ['Harissa de teste', 0],
    ]);

    // Sold out on Glovo stays sold out here.
    const pasteis = await db.menuProduct.findFirstOrThrow({ where: { organizationId: f.org.id, translations: { some: { name: 'Pastéis de teste' } } } });
    expect(pasteis.soldOut).toBe(true);

    // Allergens are never imported as verified.
    expect(tajine.allergensVerifiedAt).toBeNull();
    expect(await db.productAllergenDeclaration.count({ where: { productId: tajine.id } })).toBe(0);

    // Drafts are invisible to guests.
    const menu = await getPublicMenu(f.location.id, 'pt', 'TABLE');
    expect(menu.flatMap((c) => c.products.map((p) => p.name))).not.toContain('Tajine especial de teste');
  });

  it('leaves the existing menu exactly as it was', async () => {
    const f = await createOrderingFixture();
    const snapshot = async () =>
      JSON.stringify(
        await db.menuProduct.findMany({
          where: { organizationId: f.org.id, origin: 'MANUAL' },
          orderBy: { id: 'asc' },
          include: { prices: { orderBy: { channel: 'asc' } }, translations: { orderBy: { language: 'asc' } }, modifierGroups: { include: { options: true } } },
        }),
      );
    const before = await snapshot();
    const job = await createImportJob(f.ctx);
    await addImportSource(f.ctx, job.id, { type: 'GLOVO', text: CAPTURE });
    await publishImport(f.ctx, job.id, { confirm: true, makeVisible: true, stations: await toKitchen(f, job.id) });
    expect(await snapshot()).toBe(before);
  });

  it('an item can be corrected during review, and only the review copy changes', async () => {
    const f = await createOrderingFixture();
    const job = await createImportJob(f.ctx);
    await addImportSource(f.ctx, job.id, { type: 'GLOVO', text: CAPTURE });
    const p = await getImportPreview(f.ctx, job.id);
    const harira = p.products.find((x) => x.name === 'Harira de teste')!;
    expect(p.categoryOptions).toContain('Tajines de teste');

    await updateImportedProduct(f.ctx, job.id, {
      importedProductId: harira.id,
      name: 'Harira corrigida de teste',
      description: 'Descrição corrigida de teste',
      categoryName: 'Sopas de teste',
      price: '7,25',
    });
    const edited = await db.importedProduct.findUniqueOrThrow({ where: { id: harira.id } });
    expect(edited).toMatchObject({ name: 'Harira corrigida de teste', categoryName: 'Sopas de teste', priceCents: 725, description: 'Descrição corrigida de teste' });
    // The photo found by the capture survives an edit.
    expect(edited.imageUrl).toBe('https://images.glovoapp.com/harira-teste.jpg');

    await expect(updateImportedProduct(f.ctx, job.id, { importedProductId: harira.id, name: 'X de teste', price: 'grátis' })).rejects.toThrow(/not a valid price/);
    await expect(updateImportedProduct(f.ctx, job.id, { importedProductId: harira.id, name: '' })).rejects.toThrow();

    const res = await publishImport(f.ctx, job.id, { confirm: true, stations: await toKitchen(f, job.id) });
    expect(res.created).toBe(3);
    const saved = await db.menuProduct.findFirstOrThrow({
      where: { organizationId: f.org.id, translations: { some: { name: 'Harira corrigida de teste' } } },
      include: { externalPrices: true, category: { include: { translations: true } } },
    });
    expect(saved.category.translations[0].name).toBe('Sopas de teste');
    // The corrected price is still a Glovo reference price, not a dine-in price.
    expect(saved.externalPrices.map((e) => e.amountCents)).toEqual([725]);
  });

  it('edits are refused once the import is published', async () => {
    const f = await createOrderingFixture();
    const job = await createImportJob(f.ctx);
    await addImportSource(f.ctx, job.id, { type: 'GLOVO', text: CAPTURE });
    const p = await getImportPreview(f.ctx, job.id);
    await publishImport(f.ctx, job.id, { confirm: true, stations: await toKitchen(f, job.id) });
    await expect(updateImportedProduct(f.ctx, job.id, { importedProductId: p.products[0].id, name: 'Depois de teste' })).rejects.toThrow(/closed/);
  });

  it('review edits are tenant-isolated', async () => {
    const a = await createOrderingFixture('Test Glovo A');
    const b = await createOrderingFixture('Test Glovo B');
    const job = await createImportJob(b.ctx);
    await addImportSource(b.ctx, job.id, { type: 'GLOVO', text: CAPTURE });
    const p = await getImportPreview(b.ctx, job.id);
    await expect(updateImportedProduct(a.ctx, job.id, { importedProductId: p.products[0].id, name: 'Roubado de teste' })).rejects.toThrow(/not found/i);
  });

  it('photos are only copied when the owner confirms the rights', async () => {
    const f = await createOrderingFixture();
    const job = await createImportJob(f.ctx);
    await addImportSource(f.ctx, job.id, { type: 'GLOVO', text: CAPTURE });
    const res = await publishImport(f.ctx, job.id, { confirm: true, imageRights: false, stations: await toKitchen(f, job.id) });
    expect(res).toMatchObject({ imagesRequested: 0, imagesSaved: 0 });
    expect(await db.productImage.count({ where: { product: { organizationId: f.org.id } } })).toBe(0);
  });

  it('a confirmed photo is stored in the tenant media bucket and linked to the dish', async () => {
    const f = await createOrderingFixture();
    const product = await db.menuProduct.findFirstOrThrow({ where: { organizationId: f.org.id } });
    const result = await copyImportedImages(f.org.id, [{ productId: product.id, url: 'https://images.glovoapp.com/harira-teste.jpg' }], async () => ({ status: 200, body: PNG }));
    expect(result).toEqual({ saved: 1, skipped: 0 });

    const image = await db.productImage.findFirstOrThrow({ where: { productId: product.id } });
    expect(image).toMatchObject({ rightsConfirmed: true, origin: 'IMPORTED' });
    // Stored under the tenant's own prefix, served by the app rather than linked to Glovo.
    expect(image.url).toMatch(new RegExp(`^/media/${f.org.id}/products/[A-Za-z0-9_-]{22}\\.png$`));
    const key = mediaKeyFromPath(image.url)!;
    expect(await storage.get(key)).toEqual(PNG);
    await storage.delete(key);
  });

  it('refuses anything that is not really an image, and keeps the dish', async () => {
    const f = await createOrderingFixture();
    const product = await db.menuProduct.findFirstOrThrow({ where: { organizationId: f.org.id } });
    const cases: { productId: string; url: string }[] = [
      { productId: product.id, url: 'https://images.glovoapp.com/not-an-image.jpg' },
      { productId: product.id, url: 'http://images.glovoapp.com/insecure.jpg' },
      { productId: product.id, url: 'https://images.glovoapp.com/missing.jpg' },
    ];
    const result = await copyImportedImages(f.org.id, cases, async (url) =>
      url.includes('missing') ? { status: 404, body: Buffer.alloc(0) } : { status: 200, body: Buffer.from('<svg onload=alert(1)>') },
    );
    expect(result).toEqual({ saved: 0, skipped: 3 });
    expect(await db.productImage.count({ where: { productId: product.id } })).toBe(0);
  });

  it('a Glovo address that is not a store page is refused, and the job stays empty', async () => {
    const f = await createOrderingFixture();
    const job = await createImportJob(f.ctx);
    // Refused before any request leaves the server, so this test needs no network. Reading a
    // real store page is covered in tests/integration/glovo-url-import.test.ts.
    const url = 'https://glovoapp.com/embedded-web-views/not-a-store';
    const r = await addImportSource(f.ctx, job.id, { type: 'GLOVO', url });
    expect(r).toMatchObject({ status: 'FAILED', items: 0 });
    expect(r.error).toMatch(/not a store page/i);
    // The link is kept for reference and nothing is created.
    const preview = await getImportPreview(f.ctx, job.id);
    expect(preview.job.status).toBe('DRAFT');
    expect(preview.summary.items).toBe(0);
    expect(preview.sources[0].url).toBe(url);
    await expect(publishImport(f.ctx, job.id, { confirm: true })).rejects.toThrow();
  });
});
