import { describe, expect, it } from 'vitest';
import { parseMapsUrl } from '@/server/discovery/google';
import { parseWebsite } from '@/server/discovery/website';

/**
 * The fixture is the structure of a real restaurant site (Casa de Marrocos): no JSON-LD, details
 * in the contact block, platform links in a delivery section. Values are the real published ones,
 * since the parser must be proven against what restaurants actually publish.
 */
const REAL_SITE = `<!doctype html><html><head>
  <title>Casa de Marrocos | Authentic Moroccan Restaurant in Braga</title>
  <meta name="description" content="Casa de Marrocos - Authentic Moroccan Restaurant in Braga, Portugal. Experience traditional Moroccan cuisine and hospitality."/>
  </head><body>
  <section><h2>Get in Touch</h2>
    <div><h3>Address</h3><p>R. de Santa Margarida 13</p><p>4710-311 Braga, Portugal</p></div>
    <div><h3>Phone &amp; WhatsApp</h3><a href="tel:+351935413677">+351 935 413 677</a>
      <a href="https://wa.me/351935413677">WhatsApp</a></div>
    <div><h3>Opening Hours</h3>
      <div><span>Monday</span><span>11:00 - 23:00</span></div>
      <div><span>Tuesday</span><span>11:00 - 23:00</span></div>
      <div><span>Wednesday</span><span>11:00 - 23:00</span></div>
      <div><span>Thursday</span><span>11:00 - 23:00</span></div>
      <div><span>Friday</span><span>11:00 - 23:00</span></div>
      <div><span>Saturday</span><span>11:00 - 23:30</span></div>
      <div><span>Sunday</span><span>Closed</span></div></div>
  </section>
  <footer><a href="mailto:info@casademarrocos.pt">info@casademarrocos.pt</a>
    <a href="https://www.instagram.com/Casademarrocos">Instagram</a>
    <a href="https://www.facebook.com/Casademarrocos/">Facebook</a>
    <a href="https://www.facebook.com/tr?id=123&amp;ev=PageView">tracking</a>
    <a href="https://glovoapp.com/en/pt/braga/stores/casa-de-marrocos-brg/">Glovo</a>
    <a href="https://www.ubereats.com/pt/store/casa-de-moroccos/30OeJSfXWYmYk2L8ls2y-g?diningMode=PICKUP&amp;pl=${'J'.repeat(600)}">Uber Eats</a>
    <a href="https://maps.app.goo.gl/fYGmH772YJmzJhxaA">Find us</a></footer>
  </body></html>`;

describe('reading a restaurant’s own website', () => {
  const r = parseWebsite(REAL_SITE, 'https://casademarrocos.com', 'PT');

  it('finds the contact details a restaurant publishes', () => {
    expect(r).toMatchObject({
      name: 'Casa de Marrocos',
      addressLine1: 'R. de Santa Margarida 13',
      postalCode: '4710-311',
      city: 'Braga',
      phone: '+351935413677',
      whatsappNumber: '+351935413677',
      email: 'info@casademarrocos.pt',
      websiteUrl: 'https://casademarrocos.com/',
    });
    expect(r.description).toContain('Moroccan Restaurant in Braga');
  });

  it('reads the whole week of opening hours, including the closed day', () => {
    expect(r.openingHours).toEqual({
      mon: [{ open: '11:00', close: '23:00' }],
      tue: [{ open: '11:00', close: '23:00' }],
      wed: [{ open: '11:00', close: '23:00' }],
      thu: [{ open: '11:00', close: '23:00' }],
      fri: [{ open: '11:00', close: '23:00' }],
      sat: [{ open: '11:00', close: '23:30' }],
      sun: [],
    });
  });

  it('keeps profile links and skips the platform’s own pages', () => {
    expect(r.instagramUrl).toBe('https://www.instagram.com/Casademarrocos');
    // facebook.com/tr is a tracking pixel, not the restaurant's page.
    expect(r.facebookUrl).toBe('https://www.facebook.com/Casademarrocos/');
    expect(r.glovoUrl).toBe('https://glovoapp.com/en/pt/braga/stores/casa-de-marrocos-brg/');
    expect(r.googleReviewUrl).toBe('https://maps.app.goo.gl/fYGmH772YJmzJhxaA');
  });

  it('keeps a store link whose tracking query would make it too long to store', () => {
    // The real Uber Eats link carries a ~600-character `pl` parameter; the column allows 500.
    expect(r.uberEatsUrl).toBe('https://www.ubereats.com/pt/store/casa-de-moroccos/30OeJSfXWYmYk2L8ls2y-g');
    expect(r.uberEatsUrl!.length).toBeLessThanOrEqual(500);
  });
});

describe('reading a site that publishes schema.org data', () => {
  const LD = `<html><head><script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'WebSite', name: 'ignored' },
      {
        '@type': 'Restaurant',
        name: 'Tasca do Teste',
        telephone: '+351 212 345 678',
        email: 'ola@tascadoteste.pt',
        servesCuisine: ['Portuguese', 'Seafood'],
        address: { '@type': 'PostalAddress', streetAddress: 'Rua de Teste 42', postalCode: '1200-123', addressLocality: 'Lisboa' },
        geo: { '@type': 'GeoCoordinates', latitude: 38.7223, longitude: -9.1393 },
        openingHoursSpecification: [
          { dayOfWeek: ['https://schema.org/Monday', 'https://schema.org/Tuesday'], opens: '12:00', closes: '15:00' },
          { dayOfWeek: 'Monday', opens: '19:00', closes: '23:00' },
        ],
        sameAs: ['https://www.instagram.com/tascadoteste', 'https://twitter.com/ignored'],
      },
    ],
  })}</script></head><body></body></html>`;

  it('prefers the structured data the site states about itself', () => {
    const r = parseWebsite(LD, 'https://tascadoteste.pt', 'PT');
    expect(r).toMatchObject({
      name: 'Tasca do Teste',
      phone: '+351212345678',
      email: 'ola@tascadoteste.pt',
      addressLine1: 'Rua de Teste 42',
      postalCode: '1200-123',
      city: 'Lisboa',
      cuisine: 'Portuguese',
      latitude: 38.7223,
      longitude: -9.1393,
      instagramUrl: 'https://www.instagram.com/tascadoteste',
    });
    expect(r.openingHours?.mon).toEqual([
      { open: '12:00', close: '15:00' },
      { open: '19:00', close: '23:00' },
    ]);
  });
});

describe('reading a page with nothing useful', () => {
  it('returns only the website address, never invented details', () => {
    const r = parseWebsite('<html><body><h1>Coming soon</h1></body></html>', 'https://example.test', 'PT');
    expect(r.websiteUrl).toBe('https://example.test/');
    expect(r.phone).toBeUndefined();
    expect(r.addressLine1).toBeUndefined();
    expect(r.postalCode).toBeUndefined();
    expect(r.openingHours).toBeUndefined();
  });

  it('refuses a postal code that is not valid for the country', () => {
    // 0000-000 is not a Portuguese code; a wrong code must not reach the form.
    const r = parseWebsite('<html><body><p>Rua Qualquer 1, 0000-000 Nowhere</p></body></html>', 'https://example.test', 'PT');
    expect(r.postalCode).toBeUndefined();
  });

  it('ignores insecure and credential-bearing links', () => {
    const r = parseWebsite('<html><body><a href="http://www.instagram.com/x">i</a><a href="https://user:pw@www.tiktok.com/@y">t</a></body></html>', 'https://example.test', 'PT');
    // http:// is upgraded to https:// for a known social host, but credentials are refused.
    expect(r.tiktokUrl).toBeUndefined();
  });
});

describe('reading a Google Maps link', () => {
  // The real link shared from Google Maps for Casa de Marrocos, after redirect resolution.
  const FULL = 'https://www.google.com/maps/place/CASA+DE+MARROCOS/@41.557498,-8.4206292,16.25z/data=!4m6!3m5!1s0xd24ff58585e9c25:0x138e6307627ce75f!8m2!3d41.5573282!4d-8.4173135!16s%2Fg%2F11nk8ty9s8?entry=tts';

  it('takes the name and the pin coordinates from the URL alone', () => {
    const link = parseMapsUrl(FULL);
    // !3d/!4d is the place pin; the @ pair is only the map centre.
    expect(link).toMatchObject({ name: 'CASA DE MARROCOS', latitude: 41.5573282, longitude: -8.4173135 });
    expect(link!.placeId).toContain('0xd24ff58585e9c25');
  });

  it('reads the allowed /maps/search form and plain coordinates', () => {
    expect(parseMapsUrl('https://www.google.com/maps/search/?api=1&query=Casa+de+Marrocos+Braga')?.name).toBe('Casa de Marrocos Braga');
    expect(parseMapsUrl('https://maps.google.com/?q=41.5573,-8.4173')).toMatchObject({ latitude: 41.5573, longitude: -8.4173 });
  });

  it('refuses links that are not Google Maps', () => {
    expect(parseMapsUrl('https://maps.apple.com/?q=x')).toBeNull();
    expect(parseMapsUrl('http://www.google.com/maps/place/X')).toBeNull();
    expect(parseMapsUrl('not a url')).toBeNull();
  });
});
