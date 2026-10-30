import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/server/db';
import { addImportSource, cancelImport, chooseCanonical, createImportJob, getImportPreview, publishImport, setImportDecision } from '@/server/import/service';
import { getPublicMenu } from '@/server/services/public-menu';
import { resetDatabase } from '../support/db';
import { createOrderingFixture } from '../support/fixtures';
import { buildXlsx } from '../support/xlsx';

const CSV = 'Categoria;Nome;Descrição;Preço\nEntradas de teste;Harira de teste;Sopa;6,50\nPratos de teste;Tajine de teste;Com ameixas;16,90\nPratos de teste;Cuscuz de teste;;sem preço\n';

describe('M5 Import Studio', () => {
  beforeEach(resetDatabase);

  it('TEST 2: CSV import → review → publish → visible on the customer menu', async () => {
    const f = await createOrderingFixture();
    const job = await createImportJob(f.ctx);
    const r = await addImportSource(f.ctx, job.id, { type: 'CSV', fileName: 'menu.csv' }, new TextEncoder().encode(CSV));
    expect(r).toMatchObject({ status: 'PARSED', items: 3 });
    // Nothing reaches the menu before publishing
    expect(await db.menuProduct.count({ where: { organizationId: f.org.id } })).toBe(2);

    const p = await getImportPreview(f.ctx, job.id);
    expect(p.job.status).toBe('NEEDS_REVIEW');
    expect(p.summary).toMatchObject({ items: 3, categories: 2, missingPrice: 1, toCreate: 3 });
    expect(p.summary.after.newCategories).toEqual(['Entradas de teste', 'Pratos de teste']);

    await expect(publishImport(f.ctx, job.id, { confirm: false })).rejects.toThrow();
    const res = await publishImport(f.ctx, job.id, { confirm: true, makeVisible: true });
    expect(res).toMatchObject({ created: 3, visible: 2, drafts: 1 }); // the dish without price stays a draft

    const menu = await getPublicMenu(f.location.id, 'pt', 'TABLE');
    const names = menu.flatMap((c) => c.products.map((x) => [c.name, x.name, x.priceCents]));
    expect(names).toEqual(expect.arrayContaining([['Entradas de teste', 'Harira de teste', 650], ['Pratos de teste', 'Tajine de teste', 1690]]));
    expect(names.some((n) => n[1] === 'Cuscuz de teste')).toBe(false);
    const imported = await db.menuProduct.findFirstOrThrow({ where: { organizationId: f.org.id, translations: { some: { name: 'Tajine de teste' } } }, include: { allergens: true } });
    expect(imported.origin).toBe('IMPORTED');
    expect(imported.allergensVerifiedAt).toBeNull();
    // Publishing twice is impossible
    await expect(publishImport(f.ctx, job.id, { confirm: true })).rejects.toThrow(/not waiting for review/);
  });

  it('TEST 19: failed imports never publish anything', async () => {
    const f = await createOrderingFixture();
    const before = await db.menuProduct.count();
    const job = await createImportJob(f.ctx);
    const bad = await addImportSource(f.ctx, job.id, { type: 'CSV', fileName: 'x.csv' }, new TextEncoder().encode('foo,bar\n1,2'));
    expect(bad.status).toBe('FAILED');
    const glovo = await addImportSource(f.ctx, job.id, { type: 'GLOVO', url: 'https://glovoapp.com/pt/en/braga/test/' });
    expect(glovo.status).toBe('UNSUPPORTED');
    const photo = await addImportSource(f.ctx, job.id, { type: 'IMAGE', fileName: 'm.jpg' }, new Uint8Array([0xff, 0xd8, 0xff, 0xe0]));
    expect(photo.status).toBe('UNSUPPORTED');
    const preview = await getImportPreview(f.ctx, job.id);
    expect(preview.job.status).toBe('DRAFT');
    expect(preview.summary.items).toBe(0);
    await expect(publishImport(f.ctx, job.id, { confirm: true, makeVisible: true })).rejects.toThrow();
    expect(await db.menuProduct.count()).toBe(before);
    const sources = await db.importSource.findMany({ where: { jobId: job.id } });
    expect(sources.map((s) => [s.type, s.status, s.connectionStatus])).toEqual([
      ['CSV', 'FAILED', 'CONNECTED'],
      ['GLOVO', 'UNSUPPORTED', 'NOT_CONFIGURED'],
      ['IMAGE', 'UNSUPPORTED', 'NOT_CONFIGURED'],
    ]);
  });

  it('Glovo + Uber Eats: one canonical dish, platform prices kept separately as references, in-house price untouched', async () => {
    const f = await createOrderingFixture();
    const job = await createImportJob(f.ctx);
    await addImportSource(f.ctx, job.id, { type: 'GLOVO', text: 'Category,Name,Price\nPratos,Tajine de Frango,16.90\nBebidas,Chá de menta,2.20' });
    await addImportSource(f.ctx, job.id, { type: 'UBER_EATS', fileName: 'uber.xlsx' }, buildXlsx([['Category', 'Item Name', 'Price'], ['Mains', 'Tajine de frango', 17.5]]));
    const p = await getImportPreview(f.ctx, job.id);
    const group = p.mappings.find((m) => !m.existingProductId)!;
    expect(group.importedProductIds).toHaveLength(2);
    expect(p.summary).toMatchObject({ items: 3, duplicateGroups: 1, toCreate: 2 });

    // Owner chooses the Uber Eats version as canonical
    const uber = p.products.find((x) => x.source.type === 'UBER_EATS')!;
    await chooseCanonical(f.ctx, job.id, group.id, uber.id);
    const res = await publishImport(f.ctx, job.id, { confirm: true, makeVisible: true });
    expect(res).toMatchObject({ created: 2, visible: 0, linkedPrices: 1 }); // platform prices never become in-house prices

    const tajine = await db.menuProduct.findFirstOrThrow({ where: { organizationId: f.org.id, translations: { some: { name: 'Tajine de frango' } } }, include: { prices: true, externalPrices: true } });
    expect(tajine.status).toBe('DRAFT');
    expect(tajine.prices).toEqual([]); // owner sets the dine-in price
    expect(tajine.externalPrices.map((e) => [e.provider, e.amountCents]).sort()).toEqual([['GLOVO', 1690], ['UBER_EATS', 1750]]);
  });

  it('never overwrites an existing dish silently; linking only adds a reference price', async () => {
    const f = await createOrderingFixture();
    const job = await createImportJob(f.ctx);
    await addImportSource(f.ctx, job.id, { type: 'GLOVO', text: 'name,price\nTest dish,19.90\nNew test dish,9.00' });
    const p = await getImportPreview(f.ctx, job.id);
    const match = p.products.find((x) => x.name === 'Test dish')!;
    expect(match.decision?.decision).toBe('SKIP');
    expect(match.decision?.targetProductId).toBe(f.dish.id);
    await setImportDecision(f.ctx, job.id, { importedProductId: match.id, decision: 'MERGE_INTO_EXISTING', targetProductId: f.dish.id });
    await publishImport(f.ctx, job.id, { confirm: true });
    const dish = await db.menuProduct.findUniqueOrThrow({ where: { id: f.dish.id }, include: { prices: true, translations: true, externalPrices: true } });
    expect(dish.prices.find((x) => x.channel === 'DINE_IN')?.amountCents).toBe(1690);
    expect(dish.translations.find((t) => t.language === 'pt')?.name).toBe('Test dish');
    expect(dish.externalPrices.map((e) => [e.provider, e.amountCents])).toEqual([['GLOVO', 1990]]);
  });

  it('cancel/rollback of an unpublished import removes extracted rows; published imports cannot be cancelled', async () => {
    const f = await createOrderingFixture();
    const job = await createImportJob(f.ctx);
    await addImportSource(f.ctx, job.id, { type: 'TEXT', text: 'PRATOS\nTajine de teste 16,90 €' });
    await cancelImport(f.ctx, job.id);
    expect(await db.importedProduct.count({ where: { jobId: job.id } })).toBe(0);
    await expect(publishImport(f.ctx, job.id, { confirm: true })).rejects.toThrow();
    const job2 = await createImportJob(f.ctx);
    await addImportSource(f.ctx, job2.id, { type: 'TEXT', text: 'PRATOS\nTajine de teste 16,90 €' });
    await publishImport(f.ctx, job2.id, { confirm: true });
    await expect(cancelImport(f.ctx, job2.id)).rejects.toThrow(/Only unpublished/);
  });

  it('import jobs are tenant-isolated', async () => {
    const a = await createOrderingFixture('Test A');
    const b = await createOrderingFixture('Test B');
    const job = await createImportJob(b.ctx);
    await expect(getImportPreview(a.ctx, job.id)).rejects.toThrow(/not found/i);
    await expect(addImportSource(a.ctx, job.id, { type: 'TEXT', text: 'Tajine 10,00 €' })).rejects.toThrow(/not found/i);
    await expect(publishImport(a.ctx, job.id, { confirm: true })).rejects.toThrow(/not found/i);
  });
});
