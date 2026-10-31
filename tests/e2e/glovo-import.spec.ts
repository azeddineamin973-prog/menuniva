import { expect, test, type Page } from '@playwright/test';
import { buildGlovoStorePage, type TestProduct } from '../support/glovo-page';
import { login, seed, sql, type Seed } from './helpers';
import { addNetFixture, routeGlovoImages, screenshot, solidPng } from './net-fixtures';

/**
 * The owner's journey, in a real browser:
 *   paste Glovo link → Import Menu → preview photos and products → review → save drafts.
 * The store page and photos are local fixtures (see net-fixtures.ts): nothing reaches Glovo.
 * The restaurant is fictitious and lives in the TEST database.
 */

let s: Seed;
test.beforeAll(() => {
  s = seed(`glv${Date.now()}`);
});

const STORE = 'https://glovoapp.com/pt/pt/braga/stores/e2e-casa-teste-brg';
const PALETTE: [number, number, number][] = [
  [178, 84, 48],
  [206, 150, 58],
  [96, 132, 74],
  [146, 66, 58],
  [116, 92, 150],
  [58, 112, 140],
];
const img = (id: string) => `dh:menus-glovo/products/${id}`;
const p = (name: string, price: number, imageId?: string, extra: Partial<TestProduct> = {}): TestProduct => ({ name, price, imageId: imageId && img(imageId), ...extra });

const SECTIONS: { title: string; products: TestProduct[] }[] = [
  {
    title: 'Entradas e2e',
    products: [
      p('Harira e2e', 4.5, 'harira', { description: 'Sopa de lentilhas e grão' }),
      p('Briouats e2e', 5.9, 'briouats', { description: 'Folhados de carne picada' }),
      p('Zaalouk e2e', 4.9, undefined, { description: 'Beringela assada com tomate' }), // no photo at all
      p('Salada marroquina e2e', 3.99, 'broken-salada'), // photo that cannot load
      p('Hummus e2e', 4.5, 'hummus'),
      p('Msemen e2e', 2.5, 'msemen'),
      p('Pastilla de frango e2e', 8.9, 'pastilla'),
      p('Batata frita e2e', 2.9, 'batata'),
    ],
  },
  {
    title: 'Tajines e2e',
    products: [
      p('Tajine de frango e2e', 12.99, 'tajine-frango', {
        description: 'Com azeitonas e limão confitado',
        groups: [
          { name: 'Tamanho', min: 1, max: 1, options: [{ name: 'Individual', priceImpact: 0 }, { name: 'Para dois', priceImpact: 9 }] },
          { name: 'Extras', min: 0, max: 3, options: [{ name: 'Pão', priceImpact: 1 }, { name: 'Harissa', priceImpact: 0.5 }] },
        ],
      }),
      p('Tajine de carne e2e', 15.5, 'tajine-carne', { description: 'Com ameixas e sésamo' }),
      p('Tajine de kefta e2e', 11.99, 'tajine-kefta'),
      p('Tajine de legumes e2e', 10.5, 'tajine-legumes'),
      p('Tajine de peixe e2e', 14.9, 'tajine-peixe'),
      p('Tajine de borrego e2e', 16.9, 'tajine-borrego'),
      p('Tajine de frango com mel e2e', 13.5, 'tajine-mel'),
      p('Tajine de carne picada e2e', 11.5, 'tajine-picada'),
      p('Tajine vegetariano e2e', 10.9, 'tajine-veg'),
      p('Tajine de camarão e2e', 15.9, 'tajine-camarao'),
    ],
  },
  {
    title: 'Cuscuz e2e',
    products: [
      p('Couscous de frango e2e', 13.99, 'cous-frango'),
      p('Couscous Tfaya e2e', 13.49, 'cous-tfaya'),
      p('Couscous de legumes e2e', 11, 'cous-legumes'),
      p('Couscous de borrego e2e', 15.5, 'cous-borrego'),
      p('Couscous real e2e', 16.9, 'cous-real'),
      p('Couscous de peixe e2e', 14.5, 'cous-peixe'),
    ],
  },
  {
    title: 'Bebidas e2e',
    products: [
      p('Chá de menta e2e', 2.2, 'cha', { soldOut: true }),
      p('Sumo de laranja e2e', 2.9, 'sumo'),
      p('Água das pedras e2e', 1.79, 'agua'),
      p('Limonada e2e', 2.5, 'limonada'),
      p('Café e2e', 1.2, 'cafe'),
      p('Coca-Cola e2e', 1.79, 'cola'),
    ],
  },
];

const ALL = SECTIONS.flatMap((x) => x.products);
const IMAGE_IDS = ALL.flatMap((x) => (x.imageId ? [x.imageId.split('/').pop()!] : []));
const PNGS = new Map(IMAGE_IDS.map((id, i) => [id, solidPng(96, 96, PALETTE[i % PALETTE.length])]));

function serveStore() {
  addNetFixture(STORE, { contentType: 'text/html; charset=utf-8', body: buildGlovoStorePage(SECTIONS) });
  // Photos the server copies at save time (requested at ?width=1000; the fixture ignores the query).
  for (const id of IMAGE_IDS) if (!id.includes('broken')) addNetFixture(`https://images.deliveryhero.io/image/menus-glovo/products/${id}`, { contentType: 'image/png', body: solidPng(240, 240, PALETTE[IMAGE_IDS.indexOf(id) % PALETTE.length]) });
}

const row = (page: Page, name: string) => page.getByTestId('import-item').filter({ has: page.getByTestId('item-name').getByText(name, { exact: true }) });
const loaded = (el: HTMLImageElement) => el.complete && el.naturalWidth > 0;

async function importFromGlovo(page: Page) {
  await page.goto(`/dashboard/${s.orgSlug}/import`);
  await expect(page.getByTestId('add-source-form')).toBeHidden(); // advanced options start collapsed
  await page.getByTestId('glovo-url-input').fill(STORE);
  await page.getByTestId('import-menu-button').click();
  await expect(page).toHaveURL(/\/import\/[a-z0-9]+$/, { timeout: 30_000 });
}

test('paste Glovo link → Import Menu → preview photos → review → save drafts', async ({ page, browser }) => {
  serveStore();
  await routeGlovoImages(page, PNGS);
  await login(page, s.owner, s.password);
  await page.goto(`/dashboard/${s.orgSlug}/import`);
  await screenshot(page, 'landing-desktop');
  await importFromGlovo(page);

  await expect(page.getByTestId('job-status')).toHaveText('Ready to review');
  await expect(page.getByTestId('import-source')).toContainText('e2e-casa-teste-brg');
  await expect(page.getByTestId('total-Products')).toContainText('30');
  await expect(page.getByTestId('total-Categories')).toContainText('4');
  await expect(page.getByTestId('total-With photos')).toContainText('29');
  await expect(page.getByTestId('total-Sizes & extras')).toContainText('1');
  await expect(page.getByTestId('total-Ready to import')).toContainText('30');

  // Photos: shown beside each product; a placeholder only where there is none or it fails to load.
  const harira = row(page, 'Harira e2e');
  await expect(harira.getByTestId('product-thumb')).toBeVisible();
  await expect.poll(() => harira.getByTestId('product-thumb').evaluate(loaded)).toBe(true);
  await expect(harira.getByTestId('product-thumb')).toHaveAttribute('src', /images\.deliveryhero\.io\/image\/menus-glovo\/products\/harira\?width=160$/);
  await expect(row(page, 'Zaalouk e2e').getByTestId('product-thumb-placeholder')).toHaveAttribute('data-reason', 'missing');
  await expect(row(page, 'Salada marroquina e2e').getByTestId('product-thumb-placeholder')).toHaveAttribute('data-reason', 'failed');
  await expect(harira).toContainText('Sopa de lentilhas e grão');
  await expect(harira).toContainText('Entradas e2e');
  await expect(harira).toContainText('4,50');
  await screenshot(page, 'review-desktop');

  // Compact table: 25 per page.
  await expect(page.getByTestId('import-item')).toHaveCount(25);
  await expect(page.getByTestId('pagination-status')).toHaveText(/Showing 1–25 of 30/);
  await page.getByRole('button', { name: 'Page 2' }).click();
  await expect(page.getByTestId('pagination-status')).toHaveText(/Showing 26–30 of 30/);
  await expect(page.getByTestId('import-item')).toHaveCount(5);

  // Search (accent-insensitive) and category filter.
  await page.getByTestId('product-search').fill('cha de menta');
  await expect(page.getByTestId('import-item')).toHaveCount(1);
  await expect(row(page, 'Chá de menta e2e').getByTestId('item-sold-out')).toBeVisible();
  await page.getByTestId('product-search').fill('tajine');
  await expect(page.getByTestId('import-item')).toHaveCount(10);
  const tajine = row(page, 'Tajine de frango e2e');
  await expect(tajine.getByTestId('item-sizes')).toContainText('Para dois');
  await expect(tajine.getByTestId('item-sizes')).toContainText('21,99'); // 12,99 + 9,00 surcharge
  await expect(tajine.getByTestId('item-extras')).toContainText('Extras · 2 options · optional, up to 2');
  await page.getByTestId('product-search').fill('');
  await page.getByTestId('category-filter').selectOption('Bebidas e2e');
  await expect(page.getByTestId('import-item')).toHaveCount(6);

  // Bulk selection: skip two drinks.
  await row(page, 'Chá de menta e2e').getByTestId('select-item').check();
  await row(page, 'Sumo de laranja e2e').getByTestId('select-item').check();
  await expect(page.getByTestId('selected-count')).toHaveText('2 selected');
  await page.getByTestId('bulk-bar').getByRole('button', { name: 'Skip' }).click();
  await expect(row(page, 'Chá de menta e2e').getByTestId('item-status')).toHaveText('Skip');
  await expect(row(page, 'Sumo de laranja e2e').getByTestId('item-status')).toHaveText('Skip');
  await expect(page.getByTestId('bulk-bar')).toHaveCount(0);
  await expect(page.getByTestId('total-Ready to import')).toContainText('28');

  // Simple editing.
  await page.getByTestId('category-filter').selectOption('all');
  await page.getByTestId('product-search').fill('briouats');
  await row(page, 'Briouats e2e').getByTestId('edit-item').click();
  const dialog = page.getByTestId('edit-item-dialog');
  await expect(dialog).toBeVisible();
  await screenshot(page, 'edit-dialog');
  await dialog.getByTestId('edit-name').fill('Briouats de carne e2e');
  await dialog.getByTestId('edit-price').fill('6,20');
  await dialog.getByTestId('save-item').click();
  await expect(dialog).toBeHidden();
  await page.getByTestId('product-search').fill('');
  await expect(row(page, 'Briouats de carne e2e')).toContainText('6,20');

  // Save as drafts: one station for every category, photo rights confirmed.
  await page.getByTestId('go-finish').click();
  const publish = page.getByTestId('publish-import-form');
  await publish.getByTestId('station-all').selectOption({ label: 'Seed Kitchen' });
  await expect(publish.getByLabel('Station for Tajines e2e')).toHaveValue(/.+/);
  await publish.getByTestId('image-rights').check();
  await publish.getByTestId('confirm-review').check();
  await screenshot(page, 'finish-desktop');
  await publish.getByRole('button', { name: 'Save 28 products as drafts' }).click();
  await expect(page.getByTestId('publish-summary')).toContainText('28 products created: 28 drafts, 0 visible.', { timeout: 30_000 });
  // 27 photos requested (29 minus the two skipped drinks); the broken one is skipped, not faked.
  await expect(page.getByTestId('publish-summary')).toContainText('26 of 27 photos copied.');
  await expect(page.getByTestId('publish-summary')).toContainText('1 option group created.');
  await screenshot(page, 'saved-desktop');

  // Glovo prices stay reference prices; products are drafts.
  const [briouats] = await sql<{ status: string; dine_in: number | null; glovo: number | null }>(
    `SELECT p.status,
            (SELECT "amountCents" FROM "ChannelPrice" c WHERE c."productId" = p.id AND c.channel = 'DINE_IN') AS dine_in,
            (SELECT "amountCents" FROM "ExternalSourcePrice" e WHERE e."productId" = p.id AND e.provider = 'GLOVO') AS glovo
       FROM "MenuProduct" p JOIN "ProductTranslation" t ON t."productId" = p.id
      WHERE p."organizationId" = $1 AND t.name = 'Briouats de carne e2e'`,
    [s.orgId],
  );
  expect(briouats).toMatchObject({ status: 'DRAFT', dine_in: null, glovo: 620 });

  // The menu shows the copied photos, served by MenuNiva itself.
  await page.goto(`/dashboard/${s.orgSlug}/menu`);
  const menuPhoto = page.getByTestId('menu-product').filter({ hasText: 'Harira e2e' }).locator('img');
  await expect(menuPhoto).toHaveAttribute('src', /^\/media\//);
  await expect.poll(() => menuPhoto.evaluate(loaded)).toBe(true);
  await expect(page.getByTestId('menu-product').filter({ hasText: 'Salada marroquina e2e' }).locator('img')).toHaveCount(0);

  // Once the owner prices and publishes a dish, guests see it with its photo.
  const [h] = await sql<{ id: string }>(`SELECT p.id FROM "MenuProduct" p JOIN "ProductTranslation" t ON t."productId" = p.id WHERE p."organizationId" = $1 AND t.name = 'Harira e2e'`, [s.orgId]);
  await sql(`INSERT INTO "ChannelPrice" (id, "productId", channel, "amountCents", "updatedAt") VALUES ('e2eprice' || $1, $1, 'DINE_IN', 450, now())`, [h.id]);
  await sql(`UPDATE "MenuProduct" SET status = 'ACTIVE' WHERE id = $1`, [h.id]);
  const guest = await browser.newPage();
  await guest.goto(`/t/${s.qrToken}`);
  const guestPhoto = guest.getByTestId('customer-product').filter({ hasText: 'Harira e2e' }).locator('img').first();
  await expect(guestPhoto).toHaveAttribute('src', /^\/media\//);
  await expect.poll(() => guestPhoto.evaluate(loaded)).toBe(true);
  await guest.close();
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('the import and review screens fit a phone screen (dark theme)', async ({ page, context, baseURL }) => {
    serveStore();
    await context.addCookies([{ name: 'mn_theme', value: 'dark', url: baseURL! }]);
    await routeGlovoImages(page, PNGS);
    await login(page, s.owner, s.password);
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

    await page.goto(`/dashboard/${s.orgSlug}/import`);
    await expect(page.getByTestId('import-menu-button')).toBeVisible();
    expect(await overflow()).toBeLessThanOrEqual(1);
    await screenshot(page, 'landing-mobile-dark');

    await importFromGlovo(page);
    await expect(page.getByTestId('import-item').first()).toBeVisible();
    await expect.poll(() => row(page, 'Harira e2e').getByTestId('product-thumb').evaluate(loaded)).toBe(true);
    // Price and status move under the name on small screens.
    await expect(row(page, 'Harira e2e')).toContainText('4,50');
    expect(await overflow()).toBeLessThanOrEqual(1);
    await screenshot(page, 'review-mobile-dark');

    await row(page, 'Harira e2e').getByTestId('edit-item').click();
    const box = await page.getByTestId('edit-item-dialog').boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= 390).toBe(true);
    await screenshot(page, 'edit-mobile-dark');
  });
});
