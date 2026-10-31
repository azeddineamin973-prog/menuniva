import { expect, test } from '@playwright/test';
import { GLOVO_CAPTURE_SNIPPET } from '../../src/lib/glovo-capture';
import { login, seed, type Seed } from './helpers';

/**
 * Proves the snippet the owner runs in their browser and the server-side parser fit together:
 * the snippet reads a rendered store page, and what it produces imports correctly.
 *
 * The page below is a stand-in for a store page (headings, cards, photos, prices, a sold-out
 * dish). No request is made to Glovo at any point.
 */

let s: Seed;
test.beforeAll(() => {
  s = seed(`gsnip${Date.now()}`);
});

const STORE_PAGE = `<!doctype html><html><head><title>Glovo</title></head><body>
  <header><h1>Test Restaurant Braga</h1><span>4.8 ★</span><span>25 min</span></header>
  <main>
    <section>
      <h2>Entradas snippet de teste</h2>
      <ul>
        <li class="product-card">
          <img src="https://images.glovoapp.com/harira.jpg" alt="Harira">
          <div><span>Harira snippet de teste</span><p>Sopa de lentilhas de teste</p><span>6,50 €</span></div>
        </li>
        <li class="product-card">
          <img src="https://images.glovoapp.com/pasteis.jpg" alt="Pasteis">
          <div><span>Pastéis snippet de teste</span><p>Esgotado</p><span>5,00 €</span></div>
        </li>
      </ul>
    </section>
    <section>
      <h2>Tajines snippet de teste</h2>
      <ul>
        <li class="product-card">
          <img src="https://images.glovoapp.com/tajine.jpg" alt="Tajine">
          <div><span>Tajine snippet de teste</span><p>Com ameixas de teste</p><span>14,90 €</span><span>-10%</span></div>
        </li>
      </ul>
    </section>
  </main>
</body></html>`;

test('the browser capture snippet reads a store page and its result imports', async ({ page }) => {
  await login(page, s.owner, s.password);

  // A stand-in store page, served from the app's own origin so sessionStorage behaves normally.
  await page.goto('/login');
  await page.setContent(STORE_PAGE);
  await page.addScriptTag({ content: GLOVO_CAPTURE_SNIPPET });

  const captured = await page.evaluate(() => JSON.stringify((window as unknown as { __menuniva: { state: () => unknown } }).__menuniva.state()));
  const parsed = JSON.parse(captured) as { source: string; collections: { title?: string; products: { name: string; price: string; description?: string; imageUrl?: string; soldOut?: boolean }[] }[] };

  expect(parsed.source).toBe('menuniva-glovo-capture');
  const byTitle = Object.fromEntries(parsed.collections.map((c) => [c.title ?? '', c.products]));
  expect(Object.keys(byTitle)).toEqual(expect.arrayContaining(['Entradas snippet de teste', 'Tajines snippet de teste']));

  const harira = byTitle['Entradas snippet de teste'].find((p) => p.name === 'Harira snippet de teste')!;
  expect(harira).toMatchObject({ price: '6,50 €', description: 'Sopa de lentilhas de teste', imageUrl: 'https://images.glovoapp.com/harira.jpg' });
  // The discount badge is not mistaken for part of the dish.
  const tajine = byTitle['Tajines snippet de teste'].find((p) => p.name === 'Tajine snippet de teste')!;
  expect(tajine.price).toBe('14,90 €');
  expect(tajine.description).not.toContain('%');
  // "Esgotado" on the card marks the dish unavailable.
  expect(byTitle['Entradas snippet de teste'].find((p) => p.name === 'Pastéis snippet de teste')!.soldOut).toBe(true);

  // What the snippet produced imports through Advanced import options → Glovo export.
  await page.goto(`/dashboard/${s.orgSlug}/import`);
  await page.getByTestId('advanced-import').locator('summary').click();
  const form = page.getByTestId('add-source-form');
  await form.getByLabel('Glovo export').check();
  await expect(form.getByTestId('glovo-capture-help')).toBeVisible();
  await form.getByTestId('source-text').fill(captured);
  await form.getByRole('button', { name: 'Import', exact: true }).click();

  await expect(page).toHaveURL(/\/import\/[a-z0-9]+$/);
  await expect(page.getByTestId('import-item')).toHaveCount(3);
  const row = page.getByTestId('import-item').filter({ hasText: 'Harira snippet de teste' });
  await expect(row).toContainText('Sopa de lentilhas de teste');
  await expect(row).toContainText('6,50');
  await expect(row).toContainText('Entradas snippet de teste');
  await expect(page.getByTestId('import-item').filter({ hasText: 'Pastéis snippet de teste' }).getByTestId('item-sold-out')).toBeVisible();
});
