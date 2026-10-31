import { expect, test } from '@playwright/test';
import { login, seed, sql, type Seed } from './helpers';
import { addNetFixture, screenshot } from './net-fixtures';

/**
 * Magic Restaurant Setup in a real browser: paste a link → review what was found → save.
 * Every outbound request (the website, the Maps short link, OpenStreetMap) is answered from a
 * local fixture, so the suite never reaches the internet. Fictitious restaurant, TEST database.
 */

let s: Seed;
test.beforeAll(() => {
  s = seed(`mag${Date.now()}`);
});

const SITE = 'https://e2e-magic-restaurant.test';
const SHORT_LINK = 'https://maps.app.goo.gl/e2eMagicTest';
const MAPS_URL =
  'https://www.google.com/maps/place/E2E+Magic+Tasca/@41.557498,-8.4206292,16.25z/data=!4m6!3m5!1s0xd24ff58585e9c25:0x138e6307627ce75f!8m2!3d41.5573282!4d-8.4173135!16s%2Fg%2F11nk8ty9s8?entry=tts';

const SITE_HTML = `<!doctype html><html><head>
  <title>E2E Magic Tasca | Moroccan food in Braga</title>
  <meta name="description" content="E2E Magic Tasca - a fictitious test restaurant in Braga."/>
  </head><body>
  <h2>Get in Touch</h2>
  <p>R. de Santa Margarida 13</p><p>4710-311 Braga, Portugal</p>
  <a href="tel:+351935413677">+351 935 413 677</a>
  <a href="https://wa.me/351935413677">WhatsApp</a>
  <a href="mailto:ola@e2e-magic-restaurant.test">Email us</a>
  <h3>Opening Hours</h3>
  <div><span>Monday</span><span>11:00 - 23:00</span></div>
  <div><span>Tuesday</span><span>11:00 - 23:00</span></div>
  <div><span>Wednesday</span><span>11:00 - 23:00</span></div>
  <div><span>Thursday</span><span>11:00 - 23:00</span></div>
  <div><span>Friday</span><span>11:00 - 23:00</span></div>
  <div><span>Saturday</span><span>11:00 - 23:30</span></div>
  <div><span>Sunday</span><span>Closed</span></div>
  <footer>
    <a href="https://www.instagram.com/e2emagictasca">Instagram</a>
    <a href="https://glovoapp.com/pt/pt/braga/stores/e2e-magic-tasca-brg">Glovo</a>
  </footer></body></html>`;

/** Nominatim's answer for a reverse lookup: a neighbour's identity, the right street. */
const OSM_REVERSE = JSON.stringify({
  name: 'E2E Neighbour Shop',
  lat: '41.5571513',
  lon: '-8.4172967',
  address: { road: 'Rua de Santa Margarida', postcode: '4710-294', city: 'Braga' },
  extratags: { phone: '+351 253 999 999', opening_hours: 'Mo-Fr 09:00-19:00' },
});

function serveAll() {
  addNetFixture(SITE, { contentType: 'text/html; charset=utf-8', body: SITE_HTML });
  addNetFixture(`${SITE}/`, { contentType: 'text/html; charset=utf-8', body: SITE_HTML });
  addNetFixture(SHORT_LINK, { status: 302, contentType: 'text/html', body: '', location: MAPS_URL });
  addNetFixture('https://nominatim.openstreetmap.org/reverse', { contentType: 'application/json', body: OSM_REVERSE });
  addNetFixture('https://nominatim.openstreetmap.org/search', { contentType: 'application/json', body: '[]' });
}

test('paste a Maps link and a website → review what was found → save in one step', async ({ page }) => {
  serveAll();
  await login(page, s.owner, s.password);
  await page.goto(`/dashboard/${s.orgSlug}/setup`);

  // The lookup leads the setup page while the details step is still open.
  await expect(page.getByRole('heading', { name: 'Find my restaurant' })).toBeVisible();
  await expect(page.getByTestId('setup-step-details')).toHaveAttribute('data-done', 'false');
  await screenshot(page, 'magic-setup-start');

  await page.getByTestId('maps-url').fill(SHORT_LINK);
  await page.getByTestId('website-url').fill(SITE);
  await page.getByTestId('discover-name').fill('E2E Magic Tasca');
  await page.getByTestId('discover-city').fill('Braga');
  await page.getByTestId('discover-button').click();

  const review = page.getByTestId('discovery-review');
  await expect(review).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Nothing saved yet')).toBeVisible();

  // Each source reports what it did.
  await expect(page.getByTestId('report-maps_link')).toContainText('Read the place name and location');
  await expect(page.getByTestId('report-website')).toContainText(SITE);
  await expect(page.getByTestId('report-google_places')).toContainText('not connected');
  await expect(page.getByTestId('report-osm')).toContainText('street address');

  // Fields are filled from the best source, and say where they came from.
  await expect(page.getByTestId('field-addressLine1')).toHaveValue('R. de Santa Margarida 13');
  await expect(page.getByTestId('field-postalCode')).toHaveValue('4710-311');
  await expect(page.getByTestId('field-city')).toHaveValue('Braga');
  await expect(page.getByTestId('field-phone')).toHaveValue('+351935413677');
  await expect(page.getByTestId('field-whatsappNumber')).toHaveValue('+351935413677');
  await expect(page.getByTestId('field-email')).toHaveValue('ola@e2e-magic-restaurant.test');
  await expect(page.getByTestId('field-instagramUrl')).toHaveValue('https://www.instagram.com/e2emagictasca');
  await expect(page.getByTestId('field-glovoUrl')).toHaveValue('https://glovoapp.com/pt/pt/braga/stores/e2e-magic-tasca-brg');
  await expect(page.getByTestId('source-addressLine1')).toContainText('Your website');
  // OpenStreetMap disagrees about the postal code; the owner can see both.
  await expect(page.getByTestId('source-postalCode')).toContainText('OpenStreetMap says 4710-294');
  // The neighbouring shop found by the reverse lookup never becomes the restaurant.
  await expect(page.getByTestId('field-name')).not.toHaveValue('E2E Neighbour Shop');
  await expect(page.getByTestId('field-phone')).not.toHaveValue('+351253999999');

  // Hours came from the owner's own site, for all seven days.
  await expect(page.getByTestId('hours-source')).toContainText('Your website');
  const hours = page.getByTestId('apply-form').locator('input[name=openingHours]');
  await expect(hours).toHaveValue(/"sat":\[\{"open":"11:00","close":"23:30"\}\]/);
  await expect(hours).toHaveValue(/"sun":\[\]/);
  await screenshot(page, 'magic-setup-review');

  // The owner corrects one value before saving.
  await page.getByTestId('field-name').fill('E2E Magic Tasca');
  await page.getByTestId('apply-button').click();
  await expect(page.getByText('Your restaurant details are saved')).toBeVisible({ timeout: 30_000 });

  const [row] = await sql<{ name: string; address: string; postal: string; city: string; phone: string; insta: string; glovo: string; hours: string; takeaway: boolean }>(
    `SELECT name, "addressLine1" AS address, "postalCode" AS postal, city, phone, "instagramUrl" AS insta, "glovoUrl" AS glovo, "openingHours"::text AS hours, "takeawayEnabled" AS takeaway
       FROM "RestaurantLocation" WHERE id = $1`,
    [s.locationId],
  );
  expect(row).toMatchObject({
    name: 'E2E Magic Tasca',
    address: 'R. de Santa Margarida 13',
    postal: '4710-311',
    city: 'Braga',
    phone: '+351935413677',
    insta: 'https://www.instagram.com/e2emagictasca',
    glovo: 'https://glovoapp.com/pt/pt/braga/stores/e2e-magic-tasca-brg',
  });
  expect(JSON.parse(row.hours)).toMatchObject({ sat: [{ open: '11:00', close: '23:30' }], sun: [] });
  expect(row.takeaway).toBe(false); // discovery never switches a channel on

  // The checklist now counts the details step, and the lookup collapses out of the way.
  await page.goto(`/dashboard/${s.orgSlug}/setup`);
  await expect(page.getByTestId('setup-step-details')).toHaveAttribute('data-done', 'true');
  await expect(page.getByTestId('magic-setup-collapsed')).toBeVisible();
  await screenshot(page, 'magic-setup-done');
});

test('a lookup with nothing to go on explains itself instead of inventing details', async ({ page }) => {
  serveAll();
  // Registered with the trailing slash too: a bare domain is normalised to "https://host/".
  const EMPTY_SITE_HTML = '<html><body><h1>Coming soon</h1></body></html>';
  addNetFixture('https://e2e-nothing-here.test', { contentType: 'text/html', body: EMPTY_SITE_HTML });
  addNetFixture('https://e2e-nothing-here.test/', { contentType: 'text/html', body: EMPTY_SITE_HTML });
  await login(page, s.owner, s.password);
  await page.goto(`/dashboard/${s.orgSlug}/setup`);
  // Details are filled in by the first test, so the panel starts collapsed.
  const collapsed = page.getByTestId('magic-setup-collapsed');
  if (await collapsed.count()) await collapsed.click();

  // Nothing to go on: the name is prefilled from the restaurant, so clear it first.
  await page.getByTestId('discover-name').fill('');
  await page.getByTestId('discover-city').fill('');
  await page.getByTestId('website-url').fill('');
  await page.getByTestId('discover-button').click();
  await expect(page.getByTestId('discover-error')).toContainText('Enter a Google Maps link');

  // A link that is not Google Maps, with nothing else to fall back on.
  await page.getByTestId('maps-url').fill('https://maps.apple.com/?q=test');
  await page.getByTestId('discover-button').click();
  await expect(page.getByTestId('discover-error')).toBeVisible();

  // A real but empty website: reported honestly, no fields invented.
  await page.getByTestId('maps-url').fill('');
  await page.getByTestId('website-url').fill('https://e2e-nothing-here.test');
  await page.getByTestId('discover-button').click();
  await expect(page.getByTestId('report-website')).toContainText('no contact details could be read', { timeout: 30_000 });
  await expect(page.getByTestId('field-addressLine1')).toHaveValue('');
  await expect(page.getByTestId('field-phone')).toHaveValue('');
});
