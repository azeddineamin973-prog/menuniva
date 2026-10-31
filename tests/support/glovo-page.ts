/**
 * Builds a Glovo store page in the structure real store pages actually use, verified against
 * live pages on 2026-10-31:
 *
 *   data.body[] → { type: "LIST", data: { title, slug, elements[] } }
 *   elements[]  → { type: "PRODUCT_ROW", data: { name, description, price, priceInfo,
 *                   imageId: "dh:…", externalId, id, storeProductId, attributeGroups[] } }
 *   groups      → { name, min, max, multipleSelection, attributes[] }
 *   attributes  → { name, priceImpact, priceInfo }
 *
 * The menu is delivered inside React server-component streaming chunks, which is how the page
 * ships it to any HTTPS client. Everything here is fictitious test data.
 */

export type TestProduct = {
  name: string;
  description?: string;
  price: number;
  imageId?: string;
  externalId?: string;
  storeProductId?: string;
  soldOut?: boolean;
  groups?: { name: string; min?: number; max?: number; options: { name: string; priceImpact: number }[] }[];
};

const money = (amount: number) => ({ amount, currencyCode: 'EUR', displayText: `${amount.toFixed(2).replace('.', ',')} €` });

let seq = 1_000_000;

function productRow(p: TestProduct) {
  seq += 1;
  return {
    type: 'PRODUCT_ROW',
    data: {
      attributeGroups: (p.groups ?? []).map((g, gi) => ({
        id: 3_000_000 + gi,
        externalId: String(gi),
        name: g.name,
        min: g.min ?? 0,
        max: g.max ?? 1,
        position: gi,
        multipleSelection: (g.max ?? 1) > 1,
        collapsedByDefault: false,
        attributes: g.options.map((o, oi) => ({ id: 5_000_000 + oi, externalId: String(oi), priceImpact: o.priceImpact, priceInfo: money(o.priceImpact), selected: false, name: o.name })),
      })),
      description: p.description,
      externalId: p.externalId ?? p.name.replace(/\s+/g, ''),
      id: String(seq),
      imageId: p.imageId,
      name: p.name,
      price: p.price,
      priceInfo: money(p.price),
      promotions: [],
      storeProductId: p.storeProductId,
      soldOut: p.soldOut,
      tags: [],
    },
  };
}

/** A whole store page, as served to an ordinary HTTPS client. */
export function buildGlovoStorePage(sections: { title: string; products: TestProduct[] }[]): string {
  const payload = {
    initialStoreContent: {
      data: {
        body: sections.map((s, i) => ({
          type: 'LIST',
          data: { title: s.title, slug: `${s.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-s.${600000 + i}`, elements: s.products.map(productRow) },
        })),
      },
    },
  };
  // React streams the page as pushes of escaped JSON strings; mirror that exactly.
  const flight = `28:${JSON.stringify(payload)}\n`;
  return [
    '<!DOCTYPE html><html lang="pt"><head><title>Glovo</title>',
    '<link rel="canonical" href="https://glovoapp.com/pt/pt/braga/stores/test-restaurant-brg"/></head><body>',
    '<div id="__next"></div>',
    `<script>self.__next_f.push([1,${JSON.stringify(flight)}])</script>`,
    '</body></html>',
  ].join('');
}

/** Glovo's "page doesn't exist" screen, which it serves with HTTP 200 for an unknown store. */
export function buildGlovoNotFoundPage(): string {
  return '<!DOCTYPE html><html><head><title>Glovo</title></head><body><div>Braga</div><script>self.__next_f.push([1,"3:{\\"notFound\\":true}\\n"])</script><p>This page doesn\'t exist</p></body></html>';
}
