import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/server/db';
import { importGlovoMenuFromUrl } from '@/server/import/glovo-fetch';
import { addImportSource, createImportJob, getImportPreview, publishImport } from '@/server/import/service';
import { resetDatabase } from '../support/db';
import { createOrderingFixture } from '../support/fixtures';
import { buildGlovoNotFoundPage, buildGlovoStorePage } from '../support/glovo-page';

/**
 * "Paste the link and the menu arrives": reads a Glovo store page server-side and imports it.
 * The page is supplied by an injected fetcher, so these tests never touch the network and
 * never depend on a live store. Shape fidelity is the fixture's job (tests/support/glovo-page.ts).
 */

const STORE_URL = 'https://glovoapp.com/pt/pt/braga/stores/test-restaurant-brg';

const PAGE = buildGlovoStorePage([
  {
    title: 'Entradas url de teste',
    products: [
      { name: 'Harira url de teste', description: 'Sopa de teste', price: 6.5, imageId: 'dh:menus-glovo/products/aaa111', storeProductId: 'sp-harira-teste' },
      { name: 'Pastéis url de teste', price: 5, soldOut: true },
    ],
  },
  {
    title: 'Tajines url de teste',
    products: [
      {
        name: 'Tajine url de teste',
        description: 'Com ameixas de teste',
        price: 14.9,
        imageId: 'dh:menus-glovo/products/bbb222',
        groups: [
          { name: 'Tamanho de teste', min: 1, max: 1, options: [{ name: 'Individual', priceImpact: 0 }, { name: 'Para dois', priceImpact: 8 }] },
          { name: 'Deseja adicionar extras?', min: 0, max: 3, options: [{ name: 'Pão de teste', priceImpact: 1.2 }, { name: 'Harissa de teste', priceImpact: 0.5 }] },
        ],
      },
    ],
  },
]);

const serve = (html: string, status = 200) => async () => ({ status, body: Buffer.from(html, 'utf8'), finalUrl: STORE_URL });

async function toKitchen(f: Awaited<ReturnType<typeof createOrderingFixture>>, jobId: string) {
  const p = await getImportPreview(f.ctx, jobId);
  return Object.fromEntries(p.stationTargets.map((t) => [t.label, f.kitchen.id]));
}

describe('Glovo import from a store link', () => {
  beforeEach(resetDatabase);

  it('reads the whole menu from the store page: categories, prices, photos, sizes, extras, sold out', async () => {
    const f = await createOrderingFixture();
    const r = await importGlovoMenuFromUrl(STORE_URL, { organizationId: f.org.id, fetchPage: serve(PAGE) });

    expect(r.status).toBe('PARSED');
    expect(r.extractionMethod).toBe('PUBLIC_PAGE'); // honest: not a partner API
    expect(r.storeUrl).toBe(STORE_URL);
    expect(r.items).toHaveLength(3);
    expect(r.items.map((i) => [i.categoryName, i.name, i.priceCents])).toEqual([
      ['Entradas url de teste', 'Harira url de teste', 650],
      ['Entradas url de teste', 'Pastéis url de teste', 500],
      ['Tajines url de teste', 'Tajine url de teste', 1490],
    ]);

    const harira = r.items[0];
    expect(harira.description).toBe('Sopa de teste');
    // `dh:` references resolve to the Delivery Hero CDN at a usable width.
    expect(harira.imageUrl).toBe('https://images.deliveryhero.io/image/menus-glovo/products/aaa111?width=800');
    expect(harira.externalId).toBe('sp-harira-teste'); // stable per-store id wins over the name
    expect(r.items[1].available).toBe(false); // sold out on Glovo

    const tajine = r.items[2];
    expect(tajine.variants).toEqual([
      { name: 'Individual', priceCents: 1490 },
      { name: 'Para dois', priceCents: 2290 },
    ]);
    expect(tajine.modifiers).toEqual([
      {
        name: 'Deseja adicionar extras?',
        minSelect: 0,
        maxSelect: 3,
        options: [
          { name: 'Pão de teste', priceDeltaCents: 120, available: undefined },
          { name: 'Harissa de teste', priceDeltaCents: 50, available: undefined },
        ],
      },
    ]);
    expect(r.warnings[0]).toContain(STORE_URL);
  });

  it('explains a mistyped or closed store instead of reporting an empty menu', async () => {
    const f = await createOrderingFixture();
    // Glovo serves its "page doesn't exist" screen with HTTP 200.
    const r = await importGlovoMenuFromUrl(STORE_URL, { organizationId: f.org.id, fetchPage: serve(buildGlovoNotFoundPage()) });
    expect(r.status).toBe('FAILED');
    expect(r.items).toEqual([]);
    expect(r.error).toMatch(/page doesn't exist|has no store/i);
    expect(r.error).toContain('test-restaurant-brg');
  });

  it('refuses links that are not Glovo store pages', async () => {
    const f = await createOrderingFixture();
    const o = { organizationId: f.org.id, fetchPage: serve(PAGE) };
    expect((await importGlovoMenuFromUrl('https://ubereats.com/store/x', o)).error).toMatch(/glovoapp\.com/);
    expect((await importGlovoMenuFromUrl('http://glovoapp.com/pt/pt/braga/stores/x', o)).error).toMatch(/https/);
    expect((await importGlovoMenuFromUrl('https://glovoapp.com/pt', o)).error).toMatch(/store page/);
    // Paths Glovo asks automated clients to leave alone are refused before any request.
    expect((await importGlovoMenuFromUrl('https://glovoapp.com/embedded-web-views/something', o)).error).toMatch(/not a store page/i);
  });

  it('reports a refusal or an outage plainly, and never invents a menu', async () => {
    const f = await createOrderingFixture();
    const id = { organizationId: f.org.id };
    expect((await importGlovoMenuFromUrl(STORE_URL, { ...id, fetchPage: serve('', 429) })).error).toMatch(/declined/i);
    expect((await importGlovoMenuFromUrl(STORE_URL, { ...id, fetchPage: serve('', 404) })).error).toMatch(/no store at that address/i);
    expect((await importGlovoMenuFromUrl(STORE_URL, { ...id, fetchPage: serve('', 503) })).error).toMatch(/unexpected status \(503\)/);
    const boom = await importGlovoMenuFromUrl(STORE_URL, {
      ...id,
      fetchPage: async () => {
        throw new Error('socket hang up');
      },
    });
    expect(boom.status).toBe('FAILED');
    expect(boom.error).toMatch(/could not be reached/i);
    expect(boom.items).toEqual([]);
  });

  it('rate-limits how often one restaurant may read a store page', async () => {
    const f = await createOrderingFixture();
    const o = { organizationId: f.org.id, fetchPage: serve(PAGE) };
    for (let i = 0; i < 12; i++) expect((await importGlovoMenuFromUrl(STORE_URL, o)).status).toBe('PARSED');
    await expect(importGlovoMenuFromUrl(STORE_URL, o)).rejects.toThrow(/too many|rate/i);
  });

  it('the store page flows through the normal review and publish rules', async () => {
    const f = await createOrderingFixture();
    const job = await createImportJob(f.ctx);
    // The same page, handed to the service as pasted content, takes the identical code path.
    const added = await addImportSource(f.ctx, job.id, { type: 'GLOVO', url: STORE_URL, text: PAGE });
    expect(added).toMatchObject({ status: 'PARSED', items: 3 });

    const preview = await getImportPreview(f.ctx, job.id);
    expect(preview.summary).toMatchObject({ items: 3, categories: 2, withSizes: 1, withExtras: 1, soldOut: 1, images: 2 });

    const res = await publishImport(f.ctx, job.id, { confirm: true, makeVisible: true, stations: await toKitchen(f, job.id) });
    // Glovo prices are references, so nothing goes live automatically.
    expect(res).toMatchObject({ created: 3, visible: 0, drafts: 3, modifierGroups: 1 });

    const tajine = await db.menuProduct.findFirstOrThrow({
      where: { organizationId: f.org.id, translations: { some: { name: 'Tajine url de teste' } } },
      include: { prices: true, externalPrices: true, variants: true, modifierGroups: { include: { options: true } } },
    });
    expect(tajine.status).toBe('DRAFT');
    expect(tajine.prices).toEqual([]);
    expect(tajine.externalPrices.map((e) => [e.provider, e.amountCents])).toEqual([['GLOVO', 1490]]);
    expect(tajine.variants).toHaveLength(2);
    expect(tajine.modifierGroups[0].options).toHaveLength(2);
  });
});
