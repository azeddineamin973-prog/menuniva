// Screenshots of the whole ordering journey and the staff screens, on phone, tablet and desktop,
// against the real-data UX sandbox (audit/ux/real-sandbox.mjs). Places sandbox orders only.
//   node audit/ux/journey-shots.mjs <out-dir> [base-url]
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const out = process.argv[2] ?? 'audit/ux/out/journey';
const base = process.argv[3] ?? 'http://localhost:3400';
const ORG = 'huihugiy';
const PASSWORD = 'sandbox-password-123';
const OWNER = 'elatmhanianiq@gmail.com';
const DRIVER = 'azeddineeiatmani42@gmail.com';
mkdirSync(out, { recursive: true });

// Sandbox only: earlier screenshot orders would hit the real safeguards (orders per phone,
// active-delivery cap). Close them and clear the counters before a new run.
{
  const { config } = await import('dotenv');
  config();
  const pg = (await import('pg')).default;
  const u = new URL(process.env.DATABASE_URL);
  u.pathname = '/menuniva_ux_real';
  const c = new pg.Client({ connectionString: u.toString() });
  await c.connect();
  await c.query(`UPDATE "Order" SET status = 'CANCELLED', "cancelReason" = 'sandbox screenshot run' WHERE "customerName" = 'Cliente Teste (sandbox)' AND status NOT IN ('CANCELLED','COMPLETED','DELIVERED')`);
  await c.query(`DELETE FROM "RateLimitBucket"`);
  await c.end();
}

const SIZES = [
  { name: 'mobile', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
  { name: 'tablet', viewport: { width: 820, height: 1180 }, isMobile: true, hasTouch: true },
  { name: 'desktop', viewport: { width: 1440, height: 900 } },
];
const settle = (page) => page.waitForTimeout(450);
const shot = async (page, name, full = false) => {
  await settle(page);
  // The Next.js development badge is not part of the product.
  await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' }).catch(() => {});
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: full });
  console.log('  ✓', name);
};
async function login(page, email) {
  await page.goto(`${base}/login`);
  await page.getByTestId('login-form').locator('input[name=email]').fill(email);
  await page.getByTestId('login-form').locator('input[name=password]').fill(PASSWORD);
  await page.getByTestId('login-form').locator('button[type=submit]').click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
}

const browser = await chromium.launch({ channel: 'chrome' });
for (const size of SIZES) {
  console.log(size.name);
  const ctx = await browser.newContext({ viewport: size.viewport, isMobile: size.isMobile, hasTouch: size.hasTouch, locale: 'pt-PT' });
  const page = await ctx.newPage();
  const p = (n) => `${size.name}-${n}`;
  await page.goto(`${base}/r/${ORG}?lang=pt`);
  await shot(page, p('01-storefront'));
  await shot(page, p('01-storefront-full'), true);
  await page.goto(`${base}/r/${ORG}/order/delivery?lang=pt`);
  await shot(page, p('02-delivery-menu'));
  const dish = page.getByTestId('customer-product').first();
  await dish.click();
  await shot(page, p('03-dish'));
  await page.getByTestId('add-to-cart').click();
  await settle(page);
  await shot(page, p('04-menu-with-cart'));
  const viewCart = page.getByTestId('view-cart');
  if (await viewCart.isVisible().catch(() => false)) await viewCart.click();
  await page.waitForTimeout(900); // server quote
  await shot(page, p('05-cart'));
  const go = page.getByTestId('go-checkout');
  if (await go.count()) await go.first().click();
  await page.waitForTimeout(600);
  if (await page.getByTestId('checkout-step').count()) await page.getByTestId('checkout-step').waitFor();
  await page.waitForTimeout(700);
  await shot(page, p('06-checkout-empty'));
  await page.getByTestId('checkout-name').fill('Cliente Teste (sandbox)');
  await page.getByTestId('checkout-phone').fill('+351 912 345 678');
  await page.getByTestId('address-input').fill('Rua de Teste, 1');
  await page.getByTestId('postal-input').fill('4705-077');
  await page.getByTestId('city-input').fill('Braga');
  await page.waitForTimeout(1200);
  await shot(page, p('07-checkout-filled'));
  await shot(page, p('07-checkout-filled-full'), true);
  await page.getByTestId('submit-order').click();
  await page.waitForURL(/\/o\//, { timeout: 20_000 });
  await shot(page, p('08-confirmation'));
  await shot(page, p('08-confirmation-full'), true);
  await ctx.close();
}

// Staff screens: desktop and phone.
for (const size of [SIZES[2], SIZES[0]]) {
  const ctx = await browser.newContext({ viewport: size.viewport, isMobile: size.isMobile, hasTouch: size.hasTouch });
  const page = await ctx.newPage();
  await login(page, OWNER);
  await page.goto(`${base}/dashboard/${ORG}/orders`);
  await page.waitForTimeout(1500);
  await shot(page, `${size.name}-10-live-orders`);
  await shot(page, `${size.name}-10-live-orders-full`, true);
  await page.goto(`${base}/dashboard/${ORG}/delivery`);
  await shot(page, `${size.name}-12-delivery-management`, true);
  await page.goto(`${base}/dashboard/${ORG}/delivery?tab=zones`);
  await shot(page, `${size.name}-13-delivery-zones`, true);
  await ctx.close();
  const dctx = await browser.newContext({ viewport: size.viewport, isMobile: size.isMobile, hasTouch: size.hasTouch });
  const d = await dctx.newPage();
  await login(d, DRIVER);
  await d.goto(`${base}/dashboard/${ORG}/driver`);
  await shot(d, `${size.name}-11-driver`, true);
  await dctx.close();
}
await browser.close();
