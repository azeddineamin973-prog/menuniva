import { expect, test } from '@playwright/test';
import { login, seed, sql, type Seed } from './helpers';
import { screenshot } from './net-fixtures';

/** An imported Glovo dish: a draft with a reference price and no dine-in price of its own. */
async function importGlovoDish(s: Seed, name: string, glovoCents: number, sizes?: { name: string; priceCents: number }[]) {
  const [menu] = await sql<{ id: string }>(`SELECT id FROM "Menu" WHERE "organizationId" = $1 LIMIT 1`, [s.orgId]);
  const id = `p${Math.random().toString(36).slice(2, 12)}`;
  const catId = `c${Math.random().toString(36).slice(2, 12)}`;
  await sql(`INSERT INTO "MenuCategory" (id, "organizationId", "menuId", "sortOrder", "updatedAt") VALUES ($1, $2, $3, 9, now())`, [catId, s.orgId, menu.id]);
  await sql(`INSERT INTO "CategoryTranslation" (id, "categoryId", language, name, status, "updatedAt") VALUES ($1, $2, 'pt', $3, 'SOURCE', now())`, [`ct${id}`, catId, `${name} cat`]);
  await sql(`INSERT INTO "MenuProduct" (id, "organizationId", "menuId", "categoryId", status, origin, "sortOrder", "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, 'DRAFT', 'IMPORTED', 1, now(), now())`, [
    id,
    s.orgId,
    menu.id,
    catId,
  ]);
  await sql(`INSERT INTO "ProductTranslation" (id, "productId", language, name, status, "updatedAt") VALUES ($1, $2, 'pt', $3, 'SOURCE', now())`, [`t${id}`, id, name]);
  await sql(`INSERT INTO "ExternalSourcePrice" (id, "productId", provider, "amountCents", currency, "externalId", "capturedAt") VALUES ($1, $2, 'GLOVO', $3, 'EUR', $4, now())`, [
    `e${id}`,
    id,
    glovoCents,
    `ext-${id}`,
  ]);
  if (sizes?.length) {
    for (const [i, v] of sizes.entries()) {
      await sql(`INSERT INTO "ProductVariant" (id, "productId", names, "priceDeltaCents", "isDefault", "isAvailable", "sortOrder") VALUES ($1, $2, $3::jsonb, 0, $4, true, $5)`, [
        `v${id}${i}`,
        id,
        JSON.stringify({ pt: v.name }),
        i === 0,
        i,
      ]);
    }
    const jobId = `j${id}`;
    const sourceId = `s${id}`;
    await sql(`INSERT INTO "ImportJob" (id, "organizationId", status, "sourceLanguage", "createdById", "createdAt", "updatedAt") VALUES ($1, $2, 'PUBLISHED', 'pt', $3, now(), now())`, [
      jobId,
      s.orgId,
      (await sql<{ id: string }>(`SELECT id FROM "User" WHERE email = $1`, [s.owner]))[0].id,
    ]);
    await sql(`INSERT INTO "ImportSource" (id, "jobId", type, status, "connectionStatus", "createdAt") VALUES ($1, $2, 'GLOVO', 'PARSED', 'LIMITED', now())`, [sourceId, jobId]);
    await sql(`INSERT INTO "ImportedProduct" (id, "jobId", "sourceId", name, "externalId", "priceCents", variants, warnings) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, ARRAY[]::text[])`, [
      `ip${id}`,
      jobId,
      sourceId,
      name,
      `ext-${id}`,
      glovoCents,
      JSON.stringify(sizes),
    ]);
  }
  return id;
}

test('Glovo prices are previewed, confirmed once, then copied exactly into dine-in prices', async ({ page }) => {
  const s = seed(`price${Date.now()}`);
  const tajine = await importGlovoDish(s, 'Imported tajine', 1490, [
    { name: 'Individual', priceCents: 1490 },
    { name: 'Para dois', priceCents: 2290 },
  ]);
  await importGlovoDish(s, 'Imported pastilla', 1600);

  await login(page, s.owner, s.password);
  await page.goto(`/dashboard/${s.orgSlug}/menu/quick`);
  await expect(page.getByTestId('unpriced-count')).toHaveText('2');

  const card = page.getByTestId('external-prices');
  await expect(card).toContainText('Use Glovo prices for dine-in');
  // The real amounts are on screen before anything happens, and the commission caveat is stated.
  await expect(card).toContainText('usually includes that platform');
  const row = card.getByTestId('proposal-row').filter({ hasText: 'Imported tajine' });
  await expect(row.getByTestId('proposed-price')).toHaveText('14,90 €');
  await expect(row).toContainText('Para dois +8,00 €'); // size difference recovered from the import
  await screenshot(page, 'glovo-prices-preview');

  const form = page.getByTestId('apply-external-form');
  // Applying is refused until the owner confirms they reviewed the amounts.
  await form.getByRole('button', { name: /Apply to/ }).click();
  await expect(form).toContainText('confirm the prices you reviewed');

  await form.getByLabel('I reviewed these prices and want to use them as my dine-in prices').check();
  await form.getByRole('button', { name: /Apply to/ }).click();
  await expect(form.getByText('Prices applied')).toBeVisible();

  await expect(page.getByTestId('unpriced-count')).toHaveText('0');
  const prices = await sql<{ amountCents: number }>(`SELECT "amountCents" FROM "ChannelPrice" WHERE "productId" = $1 AND channel = 'DINE_IN'`, [tajine]);
  expect(prices[0].amountCents).toBe(1490); // exact, no rounding
  const variants = await sql<{ priceDeltaCents: number }>(`SELECT "priceDeltaCents" FROM "ProductVariant" WHERE "productId" = $1 ORDER BY "sortOrder"`, [tajine]);
  expect(variants.map((v) => v.priceDeltaCents)).toEqual([0, 800]);
  // The Glovo reference price is kept, not moved.
  const ext = await sql<{ amountCents: number }>(`SELECT "amountCents" FROM "ExternalSourcePrice" WHERE "productId" = $1`, [tajine]);
  expect(ext[0].amountCents).toBe(1490);
  // Pricing is not publishing: the dishes are still drafts.
  const statuses = await sql<{ status: string }>(`SELECT status FROM "MenuProduct" WHERE "organizationId" = $1 AND origin = 'IMPORTED'`, [s.orgId]);
  expect(statuses.every((p) => p.status === 'DRAFT')).toBe(true);
});

test('a price the owner typed is never overwritten without being asked for', async ({ page }) => {
  const s = seed(`price2${Date.now()}`);
  const dish = await importGlovoDish(s, 'Imported harira', 900);
  await login(page, s.owner, s.password);
  await page.goto(`/dashboard/${s.orgSlug}/menu/quick`);

  // The owner prices it themselves, lower than Glovo.
  const row = page.getByTestId('price-row').filter({ hasText: 'Imported harira' });
  await row.locator('input[name=price]').fill('7,50');
  await row.getByRole('button', { name: 'Save' }).click();
  await expect(row.getByText('Saved')).toBeVisible();

  await page.reload();
  const card = page.getByTestId('external-prices');
  // The row is listed but not ticked, and says what is already there.
  const proposal = card.getByTestId('proposal-row').filter({ hasText: 'Imported harira' });
  await expect(proposal).toContainText('7,50');
  await expect(proposal.locator('input[type=checkbox]')).not.toBeChecked();

  const form = page.getByTestId('apply-external-form');
  await form.getByLabel('I reviewed these prices and want to use them as my dine-in prices').check();
  await form.getByRole('button', { name: /Apply to/ }).click();
  await expect(form).toContainText('already has a dine-in price');
  expect((await sql<{ amountCents: number }>(`SELECT "amountCents" FROM "ChannelPrice" WHERE "productId" = $1 AND channel = 'DINE_IN'`, [dish]))[0].amountCents).toBe(750);
});

test('one price for several dishes at once', async ({ page }) => {
  const s = seed(`price3${Date.now()}`);
  await importGlovoDish(s, 'Imported chá verde', 250);
  await importGlovoDish(s, 'Imported chá preto', 250);
  await login(page, s.owner, s.password);
  await page.goto(`/dashboard/${s.orgSlug}/menu/quick`);

  const bulk = page.getByTestId('bulk-price-form');
  await bulk.getByLabel('Price €').fill('2,50');
  for (const name of ['Imported chá verde', 'Imported chá preto']) {
    await bulk.locator('label', { hasText: name }).locator('input[type=checkbox]').check();
  }
  await bulk.getByRole('button', { name: 'Set price for selected' }).click();
  // With nothing left unpriced the bulk card has done its job and is gone from the page.
  await expect(page.getByTestId('unpriced-count')).toHaveText('0');
  await expect(page.getByTestId('bulk-price')).toHaveCount(0);

  const prices = await sql<{ amountCents: number }>(
    `SELECT cp."amountCents" FROM "ChannelPrice" cp JOIN "MenuProduct" p ON p.id = cp."productId" WHERE p."organizationId" = $1 AND cp.channel = 'DINE_IN' AND p.origin = 'IMPORTED'`,
    [s.orgId],
  );
  expect(prices.map((p) => p.amountCents)).toEqual([250, 250]);
});

test('kitchen and café routing for a whole menu in one submit, with suggestions to check', async ({ page }) => {
  const s = seed(`station${Date.now()}`);
  await importGlovoDish(s, 'Imported tajine', 1490);
  // Rename one imported category to something that reads as drinks.
  await sql(`UPDATE "CategoryTranslation" SET name = 'Bebidas e chá' WHERE name = 'Imported tajine cat'`);
  await login(page, s.owner, s.password);
  await page.goto(`/dashboard/${s.orgSlug}/stations`);

  await expect(page.getByTestId('unassigned-count')).not.toHaveText('0');
  // The seed has one Kitchen station, so a drinks category wants a café the restaurant lacks.
  await expect(page.getByTestId('category-routing')).toContainText('Café');
  await page.getByTestId('add-station-form').getByLabel('Name').fill('Seed Café');
  await page.getByTestId('add-station-form').getByLabel('Type').selectOption('CAFE');
  await page.getByTestId('add-station-form').getByRole('button', { name: 'Add station' }).click();
  await expect(page.getByTestId('add-station-form').getByText('Saved')).toBeVisible();

  await page.reload();
  const routing = page.getByTestId('category-routing-form');
  const drinks = page.getByTestId('routing-row').filter({ hasText: 'Bebidas e chá' });
  await expect(drinks).toContainText('suggested: Seed Café');
  await screenshot(page, 'station-routing-suggestions');

  await routing.getByRole('button', { name: 'Save routing' }).click();
  await expect(routing.getByText('Routing saved')).toBeVisible();
  await expect(page.getByTestId('unassigned-count')).toHaveText('0');

  // The drinks category really points at the café, and the food at the kitchen.
  const rows = await sql<{ name: string; station: string }>(
    `SELECT ct.name, ks.name AS station FROM "MenuCategory" mc
       JOIN "CategoryTranslation" ct ON ct."categoryId" = mc.id
       JOIN "KitchenStation" ks ON ks.id = mc."defaultStationId"
     WHERE mc."organizationId" = $1`,
    [s.orgId],
  );
  expect(rows.find((r) => r.name === 'Bebidas e chá')?.station).toBe('Seed Café');
  expect(rows.find((r) => r.name === 'Seed pratos')?.station).toBe('Seed Kitchen');
});

test('a restaurant with no stations is asked which ones it uses; none are invented', async ({ page }) => {
  const s = seed(`station2${Date.now()}`);
  await sql(`DELETE FROM "KitchenStation" WHERE "organizationId" = $1`, [s.orgId]);
  await login(page, s.owner, s.password);
  await page.goto(`/dashboard/${s.orgSlug}/stations`);

  const create = page.getByTestId('create-stations-form');
  await expect(create).toBeVisible();
  // Nothing exists until the owner presses the button.
  expect(await sql(`SELECT id FROM "KitchenStation" WHERE "organizationId" = $1`, [s.orgId])).toHaveLength(0);

  await create.getByRole('button', { name: 'Create these stations' }).click();
  // Once the stations exist the question is answered, so the card is replaced by the routing one.
  await expect(page.getByTestId('category-routing')).toBeVisible();
  await expect(page.getByTestId('create-stations-form')).toHaveCount(0);
  const stations = await sql<{ name: string; type: string }>(`SELECT name, type FROM "KitchenStation" WHERE "organizationId" = $1 ORDER BY "sortOrder"`, [s.orgId]);
  expect(stations).toEqual([
    { name: 'Kitchen', type: 'KITCHEN' },
    { name: 'Café', type: 'CAFE' },
  ]);
});
