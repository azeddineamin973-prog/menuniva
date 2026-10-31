import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/server/db';
import {
  bulkUpdateImportedProducts,
  copyImportedImages,
  getImportPreview,
  publishImport,
  startImport,
  updateImportedProduct,
} from '@/server/import/service';
import { resetDatabase } from '../support/db';
import { createOrderingFixture } from '../support/fixtures';
import { buildGlovoStorePage } from '../support/glovo-page';

/**
 * The redesigned review flow: one-step import, bulk review actions and photo copying.
 * Fictitious "Test …" restaurants in the TEST database only; no network.
 */

const PAGE = buildGlovoStorePage([
  {
    title: 'Entradas revisão teste',
    products: [
      { name: 'Harira revisão teste', price: 6.5, imageId: 'dh:menus-glovo/products/rev1' },
      { name: 'Briouats revisão teste', price: 5.5 },
    ],
  },
  { title: 'Tajines revisão teste', products: [{ name: 'Tajine revisão teste', price: 14.9, imageId: 'dh:menus-glovo/products/rev2' }] },
]);

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489', 'hex');

async function stationsFor(f: Awaited<ReturnType<typeof createOrderingFixture>>, jobId: string) {
  const p = await getImportPreview(f.ctx, jobId);
  return Object.fromEntries(p.stationTargets.map((t) => [t.label, f.kitchen.id]));
}

describe('one-step import', () => {
  beforeEach(resetDatabase);

  it('creates an import only when products were found', async () => {
    const f = await createOrderingFixture();
    const before = await db.importJob.count({ where: { organizationId: f.org.id } });
    // Refused before any request: not a store page. No empty import is left behind.
    await expect(startImport(f.ctx, { type: 'GLOVO', url: 'https://glovoapp.com/embedded-web-views/not-a-store' })).rejects.toThrow(/not a store page/i);
    await expect(startImport(f.ctx, { type: 'CSV', text: 'foo,bar\n1,2' })).rejects.toThrow(/name/i);
    expect(await db.importJob.count({ where: { organizationId: f.org.id } })).toBe(before);

    const r = await startImport(f.ctx, { type: 'GLOVO', url: 'https://glovoapp.com/pt/pt/braga/stores/test-restaurant-brg', text: PAGE });
    expect(r.items).toBe(3);
    const preview = await getImportPreview(f.ctx, r.jobId);
    expect(preview.job.status).toBe('NEEDS_REVIEW');
    expect(preview.sources.map((s) => [s.type, s.status])).toEqual([['GLOVO', 'PARSED']]);
  });
});

describe('bulk review actions', () => {
  beforeEach(resetDatabase);

  it('skips, re-includes and moves many products at once', async () => {
    const f = await createOrderingFixture();
    const { jobId } = await startImport(f.ctx, { type: 'GLOVO', text: PAGE });
    const p = await getImportPreview(f.ctx, jobId);
    const id = (name: string) => p.products.find((x) => x.name === name)!.id;
    const both = [id('Harira revisão teste'), id('Briouats revisão teste')];

    await bulkUpdateImportedProducts(f.ctx, jobId, { action: 'skip', ids: both });
    let after = await getImportPreview(f.ctx, jobId);
    expect(after.summary).toMatchObject({ toCreate: 1, skipped: 2 });

    await bulkUpdateImportedProducts(f.ctx, jobId, { action: 'include', ids: [both[0]] });
    after = await getImportPreview(f.ctx, jobId);
    expect(after.summary).toMatchObject({ toCreate: 2, skipped: 1 });

    await bulkUpdateImportedProducts(f.ctx, jobId, { action: 'category', ids: both, categoryName: 'Sopas revisão teste' });
    const moved = await db.importedProduct.findMany({ where: { id: { in: both } } });
    expect(moved.map((m) => m.categoryName)).toEqual(['Sopas revisão teste', 'Sopas revisão teste']);
  });

  it('decisions made in bulk survive a rename that rebuilds the suggestions', async () => {
    const f = await createOrderingFixture();
    const { jobId } = await startImport(f.ctx, { type: 'GLOVO', text: PAGE });
    const p = await getImportPreview(f.ctx, jobId);
    const harira = p.products.find((x) => x.name === 'Harira revisão teste')!;
    await bulkUpdateImportedProducts(f.ctx, jobId, { action: 'skip', ids: [harira.id] });
    await updateImportedProduct(f.ctx, jobId, { importedProductId: harira.id, name: 'Harira renomeada teste' });
    const again = await getImportPreview(f.ctx, jobId);
    expect(again.products.find((x) => x.id === harira.id)!.decision?.decision).toBe('SKIP');
  });

  it('only skipped products stay off the menu when saving', async () => {
    const f = await createOrderingFixture();
    const { jobId } = await startImport(f.ctx, { type: 'GLOVO', text: PAGE });
    const p = await getImportPreview(f.ctx, jobId);
    await bulkUpdateImportedProducts(f.ctx, jobId, { action: 'skip', ids: [p.products.find((x) => x.name === 'Briouats revisão teste')!.id] });
    const res = await publishImport(f.ctx, jobId, { confirm: true, stations: await stationsFor(f, jobId) });
    expect(res).toMatchObject({ created: 2, skipped: 1, drafts: 2 });
    const names = (await db.productTranslation.findMany({ where: { product: { organizationId: f.org.id, origin: 'IMPORTED' } }, select: { name: true } })).map((t) => t.name).sort();
    expect(names).toEqual(['Harira revisão teste', 'Tajine revisão teste']);
  });

  it('refuses invalid or foreign requests', async () => {
    const a = await createOrderingFixture('Test Bulk A');
    const b = await createOrderingFixture('Test Bulk B');
    const { jobId } = await startImport(b.ctx, { type: 'GLOVO', text: PAGE });
    const ids = (await getImportPreview(b.ctx, jobId)).products.map((x) => x.id);
    await expect(bulkUpdateImportedProducts(a.ctx, jobId, { action: 'skip', ids })).rejects.toThrow(/not found/i);
    await expect(bulkUpdateImportedProducts(b.ctx, jobId, { action: 'skip', ids: ['not-an-id'] })).rejects.toThrow(/not found/i);
    await expect(bulkUpdateImportedProducts(b.ctx, jobId, { action: 'skip', ids: [] })).rejects.toThrow();
    await expect(bulkUpdateImportedProducts(b.ctx, jobId, { action: 'category', ids, categoryName: ' ' })).rejects.toThrow();
    await publishImport(b.ctx, jobId, { confirm: true, stations: await stationsFor(b, jobId) });
    await expect(bulkUpdateImportedProducts(b.ctx, jobId, { action: 'include', ids })).rejects.toThrow(/closed/i);
  });
});

describe('photo copying', () => {
  beforeEach(resetDatabase);

  it('asks the Glovo CDN for a sensible size and copies photos in parallel', async () => {
    const f = await createOrderingFixture();
    const products = await db.menuProduct.findMany({ where: { organizationId: f.org.id }, take: 2 });
    const requested: string[] = [];
    let inFlight = 0;
    let peak = 0;
    const images = Array.from({ length: 8 }, (_, i) => ({ productId: products[i % 2].id, url: `https://images.deliveryhero.io/image/menus-glovo/products/p${i}?width=800` }));
    const res = await copyImportedImages(f.org.id, images, async (url) => {
      requested.push(url);
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 20));
      inFlight--;
      return { status: 200, body: PNG };
    });
    expect(res).toEqual({ saved: 8, skipped: 0 });
    expect(requested.every((u) => u.endsWith('?width=1000'))).toBe(true);
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(6);
    const stored = await db.productImage.findMany({ where: { productId: { in: products.map((p) => p.id) } } });
    expect(stored).toHaveLength(8);
    expect(stored.every((s) => s.rightsConfirmed && s.origin === 'IMPORTED' && s.url.startsWith(`/media/${f.org.id}/products/`))).toBe(true);
  });
});

describe('interface language', () => {
  beforeEach(resetDatabase);

  it('new accounts use English unless the person chooses another language', async () => {
    const u = await db.user.create({ data: { name: 'Test Language', email: `lang${Date.now()}@test.menuniva.local`, passwordHash: 'not-a-real-hash' } });
    expect(u.preferredLanguage).toBe('en');
  });
});
