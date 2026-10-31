import { describe, expect, it } from 'vitest';
import { GLOVO_CAPTURE_SOURCE } from '@/lib/glovo-capture';
import { extractJsonPayloads, parseGlovoCapture, parseGlovoStoreUrl } from '@/server/import/glovo';

/**
 * Fixtures are shaped like what a Glovo store payload looks like, with the fields this parser
 * recognises. They are test data for a fictitious restaurant, not captured from any real store.
 */
const STORE_PAYLOAD = {
  data: {
    body: [
      {
        data: {
          elements: [
            {
              type: 'COLLECTION',
              data: {
                title: 'Entradas de teste',
                elements: [
                  {
                    type: 'PRODUCT_TILE',
                    data: {
                      id: 9001,
                      externalId: 'TEST-9001',
                      name: 'Harira de teste',
                      description: 'Sopa de lentilhas de teste',
                      price: 6.5,
                      priceInfo: { amount: 6.5, currencyCode: 'EUR', displayText: '6,50 €' },
                      imageUrl: 'https://images.glovoapp.com/Products/{w}x{h}/harira-teste.jpg',
                      soldOut: false,
                    },
                  },
                ],
              },
            },
            {
              type: 'COLLECTION',
              data: {
                title: 'Tajines de teste',
                elements: [
                  {
                    type: 'PRODUCT_TILE',
                    data: {
                      id: 9002,
                      name: 'Tajine de teste',
                      description: 'Com ameixas de teste',
                      priceInfo: { amount: 14.9, currencyCode: 'EUR', displayText: '14,90 €' },
                      imageUrl: 'https://images.glovoapp.com/Products/tajine-teste.jpg',
                      soldOut: false,
                      attributeGroups: [
                        { name: 'Tamanho de teste', minSelect: 1, maxSelect: 1, attributes: [{ name: 'Individual', priceImpact: 0 }, { name: 'Para dois', priceImpact: 8 }] },
                        {
                          name: 'Extras de teste',
                          minSelect: 0,
                          maxSelect: 3,
                          attributes: [{ name: 'Pão de teste', priceImpact: 1.2 }, { name: 'Harissa de teste', priceImpact: 0.5 }, { name: 'Azeitonas de teste', priceImpact: 0.9, soldOut: true }],
                        },
                      ],
                    },
                  },
                  { type: 'PRODUCT_TILE', data: { id: 9003, name: 'Cordeiro de teste', priceInfo: { displayText: '17,50 €' }, soldOut: true } },
                ],
              },
            },
          ],
        },
      },
    ],
  },
};

const CAPTURE = {
  source: GLOVO_CAPTURE_SOURCE,
  version: 1,
  url: 'https://glovoapp.com/en/pt/braga/stores/test-restaurant',
  capturedAt: '2026-10-30T12:00:00.000Z',
  collections: [
    { title: 'Entradas de teste', products: [{ name: 'Harira de teste', description: 'Sopa de teste', price: '6,50 €', imageUrl: 'https://images.glovoapp.com/harira.jpg' }] },
    { title: 'Bebidas de teste', products: [{ name: 'Chá de teste', price: '2,20 €', soldOut: true }] },
  ],
  raw: [],
};

const item = (r: ReturnType<typeof parseGlovoCapture>, name: string) => r.items.find((i) => i.name === name);

describe('Glovo store links', () => {
  it('reads the store slug from every public link form', () => {
    expect(parseGlovoStoreUrl('https://glovoapp.com/pt/en/braga/casa-de-marrocos-braga/')).toMatchObject({ slug: 'casa-de-marrocos-braga', city: 'braga' });
    expect(parseGlovoStoreUrl('https://glovoapp.com/en/pt/braga/stores/casa-de-marrocos-braga')).toMatchObject({ slug: 'casa-de-marrocos-braga', city: 'braga' });
    // Query strings and tracking parameters are dropped.
    expect(parseGlovoStoreUrl('https://glovoapp.com/en/pt/braga/stores/test-restaurant?utm_source=x#menu').url).toBe('https://glovoapp.com/en/pt/braga/stores/test-restaurant');
  });

  it('refuses anything that is not a Glovo store page', () => {
    expect(() => parseGlovoStoreUrl('https://ubereats.com/store/x')).toThrow(/glovoapp\.com/);
    expect(() => parseGlovoStoreUrl('http://glovoapp.com/en/pt/braga/stores/x')).toThrow(/https/);
    expect(() => parseGlovoStoreUrl('https://glovoapp.com/pt')).toThrow(/store page/);
    expect(() => parseGlovoStoreUrl('not a link')).toThrow(/valid link/);
  });
});

describe('Glovo menu capture', () => {
  it('extracts categories, prices, photos and ids from a store payload', () => {
    const r = parseGlovoCapture(JSON.stringify(STORE_PAYLOAD));
    expect(r.status).toBe('PARSED');
    expect(r.items).toHaveLength(3);
    expect(item(r, 'Harira de teste')).toMatchObject({
      categoryName: 'Entradas de teste',
      description: 'Sopa de lentilhas de teste',
      priceCents: 650,
      currency: 'EUR',
      externalId: 'TEST-9001',
      available: true,
    });
    // Templated CDN sizes are resolved to a real URL.
    expect(item(r, 'Harira de teste')!.imageUrl).toBe('https://images.glovoapp.com/Products/600x600/harira-teste.jpg');
    // Numeric product ids are kept, so a later re-import matches the same dish.
    expect(item(r, 'Tajine de teste')!.externalId).toBe('9002');
  });

  it('splits sizes from extras and converts surcharges to absolute size prices', () => {
    const tajine = item(parseGlovoCapture(JSON.stringify(STORE_PAYLOAD)), 'Tajine de teste')!;
    expect(tajine.priceCents).toBe(1490);
    // "Tamanho" is a size group: Glovo states +8,00 €, MenuNiva needs the absolute price.
    expect(tajine.variants).toEqual([
      { name: 'Individual', priceCents: 1490 },
      { name: 'Para dois', priceCents: 2290 },
    ]);
    // Everything else stays an option group, with its surcharges and its selection limits.
    expect(tajine.modifiers).toEqual([
      {
        name: 'Extras de teste',
        minSelect: 0,
        maxSelect: 3,
        options: [
          { name: 'Pão de teste', priceDeltaCents: 120, available: undefined },
          { name: 'Harissa de teste', priceDeltaCents: 50, available: undefined },
          { name: 'Azeitonas de teste', priceDeltaCents: 90, available: false },
        ],
      },
    ]);
  });

  it('keeps sold-out dishes and flags them instead of dropping them', () => {
    const r = parseGlovoCapture(JSON.stringify(STORE_PAYLOAD));
    const cordeiro = item(r, 'Cordeiro de teste')!;
    expect(cordeiro).toMatchObject({ priceCents: 1750, available: false, categoryName: 'Tajines de teste' });
    expect(cordeiro.warnings).toContain('Marked as sold out on Glovo.');
    expect(r.warnings.some((w) => /sold out/i.test(w))).toBe(true);
  });

  it('always states that platform prices are reference prices', () => {
    expect(parseGlovoCapture(JSON.stringify(STORE_PAYLOAD)).warnings.some((w) => /reference price/i.test(w))).toBe(true);
  });

  it('reads the simplified capture made from the rendered page', () => {
    const r = parseGlovoCapture(JSON.stringify(CAPTURE));
    expect(r.status).toBe('PARSED');
    expect(r.items.map((i) => [i.categoryName, i.name, i.priceCents])).toEqual([
      ['Entradas de teste', 'Harira de teste', 650],
      ['Bebidas de teste', 'Chá de teste', 220],
    ]);
    expect(item(r, 'Chá de teste')!.available).toBe(false);
  });

  it('imports a dish repeated across collections only once, keeping the richest version', () => {
    const repeated = {
      collections: [
        { title: 'Populares de teste', products: [{ name: 'Harira de teste', price: '6,50 €' }] },
        { title: 'Entradas de teste', products: [{ name: 'Harira de teste', price: '6,50 €', description: 'Sopa de teste', imageUrl: 'https://images.glovoapp.com/h.jpg' }] },
      ],
    };
    const r = parseGlovoCapture(JSON.stringify(repeated));
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ description: 'Sopa de teste', imageUrl: 'https://images.glovoapp.com/h.jpg' });
  });

  it('finds the menu inside a saved store page', () => {
    const html = `<!doctype html><html><head><title>Glovo</title></head><body><div id="x"></div>
      <script type="application/json">${JSON.stringify(CAPTURE)}</script>
      <script>window.foo = 1;</script></body></html>`;
    const r = parseGlovoCapture(html);
    expect(r.status).toBe('PARSED');
    expect(r.items.map((i) => i.name)).toEqual(['Harira de teste', 'Chá de teste']);
  });

  it('reads React streaming chunks from a saved page', () => {
    const chunk = JSON.stringify(`a:${JSON.stringify(CAPTURE)}`);
    const r = parseGlovoCapture(`<script>self.__next_f.push([1,${chunk}])</script>`);
    expect(r.items.map((i) => i.name)).toEqual(['Harira de teste', 'Chá de teste']);
  });

  it('never invents a menu: unreadable input fails with an explanation', () => {
    const empty = parseGlovoCapture('hello, this is not a menu');
    expect(empty.status).toBe('FAILED');
    expect(empty.items).toEqual([]);
    expect(empty.error).toMatch(/No menu data/);

    const noDishes = parseGlovoCapture(JSON.stringify({ store: { name: 'Test Restaurant', open: true }, collections: [] }));
    expect(noDishes.status).toBe('FAILED');
    expect(noDishes.items).toEqual([]);
    expect(noDishes.error).toMatch(/No dishes were found/);

    expect(parseGlovoCapture('').status).toBe('FAILED');
  });

  it('does not mistake option choices for dishes', () => {
    const r = parseGlovoCapture(
      JSON.stringify({
        collections: [{ title: 'Bebidas de teste', products: [{ name: 'Chá de teste', price: '2,20 €', attributeGroups: [{ name: 'Açúcar de teste', attributes: [{ name: 'Com mel de teste', priceImpact: 0.5 }] }] }] }],
      }),
    );
    expect(r.items).toHaveLength(1);
    expect(r.items[0].modifiers?.[0].options).toEqual([{ name: 'Com mel de teste', priceDeltaCents: 50, available: undefined }]);
  });

  it('flags an implausible price instead of importing it silently', () => {
    const r = parseGlovoCapture(JSON.stringify({ collections: [{ title: 'Testes', products: [{ name: 'Preço estranho de teste', price: '1190,00 €' }] }] }));
    expect(r.items[0].priceCents).toBe(119000);
    expect(r.items[0].warnings.some((w) => /Unusual price/.test(w))).toBe(true);
  });

  it('reads a flat list of extras as one option group', () => {
    const r = parseGlovoCapture(JSON.stringify({ collections: [{ title: 'Testes', products: [{ name: 'Prato de teste', price: '9,00 €', extras: [{ name: 'Queijo de teste', price: 1.5 }] }] }] }));
    expect(r.items[0].modifiers).toEqual([{ name: 'Extras', minSelect: undefined, maxSelect: undefined, options: [{ name: 'Queijo de teste', priceDeltaCents: 150, available: undefined }] }]);
  });
});

describe('payload extraction', () => {
  it('returns nothing for text that holds no JSON', () => {
    expect(extractJsonPayloads('just some words')).toEqual([]);
    expect(extractJsonPayloads('')).toEqual([]);
  });

  it('parses a bare JSON paste', () => {
    expect(extractJsonPayloads('{"a":1}')).toEqual([{ a: 1 }]);
  });
});
