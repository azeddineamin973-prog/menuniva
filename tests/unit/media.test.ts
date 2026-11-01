import { describe, expect, it } from 'vitest';
import { isMediaFormat, isMediaWidth, isOwnMedia, MEDIA_WIDTHS, mediaSrcSet, mediaVariantUrl } from '@/lib/media';
import { MEDIA_KEY, VARIANT_KEY, variantKey, variantKeys } from '@/server/storage';

const OWN = '/media/cmorg123/products/AbCdEfGhIjKlMnOpQrStUv.jpg';

describe('responsive photo variants', () => {
  it('recognises exactly the photos the server stores (in step with MEDIA_KEY)', () => {
    for (const p of [OWN, '/media/cmorg123/branding/AbCdEfGhIjKlMnOpQrStUv.png', '/media/a1/products/AbCdEfGhIjKlMnOpQrStUv.webp']) {
      expect(isOwnMedia(p), p).toBe(true);
      expect(MEDIA_KEY.test(p.slice('/media/'.length)), p).toBe(true);
    }
    for (const p of [
      'https://images.deliveryhero.io/image/x.jpg',
      '/media/cmorg123/products/short.jpg',
      '/media/cmorg123/other/AbCdEfGhIjKlMnOpQrStUv.jpg',
      '/media/cmorg123/products/AbCdEfGhIjKlMnOpQrStUv.gif',
      `${OWN}?w=320&f=webp`,
      null,
      '',
    ]) {
      expect(isOwnMedia(p), String(p)).toBe(false);
      if (p) expect(MEDIA_KEY.test(p.replace(/^\/media\//, '')), p).toBe(false);
    }
  });

  it('builds srcset candidates per format', () => {
    expect(mediaVariantUrl(OWN, 320, 'avif')).toBe(`${OWN}?w=320&f=avif`);
    expect(mediaSrcSet(OWN, 'webp', [160, 320])).toBe(`${OWN}?w=160&f=webp 160w, ${OWN}?w=320&f=webp 320w`);
  });

  it('only fixed widths and two formats exist', () => {
    expect(MEDIA_WIDTHS.every(isMediaWidth)).toBe(true);
    for (const w of [0, 1, 321, 4000, Number.NaN]) expect(isMediaWidth(w)).toBe(false);
    expect(isMediaFormat('avif') && isMediaFormat('webp')).toBe(true);
    for (const f of ['png', 'jpg', 'gif', '', null]) expect(isMediaFormat(f)).toBe(false);
  });

  it('variant keys sit next to the original and can never be mistaken for an original', () => {
    const key = OWN.slice('/media/'.length);
    expect(variantKey(key, 640, 'avif')).toBe(`${key}.w640.avif`);
    expect(VARIANT_KEY.test(variantKey(key, 640, 'avif'))).toBe(true);
    expect(MEDIA_KEY.test(variantKey(key, 640, 'avif'))).toBe(false);
    // Every possible copy is known, so deleting a photo can delete all of them.
    expect(variantKeys(key)).toHaveLength(MEDIA_WIDTHS.length * 2);
    expect(variantKeys(key).every((k) => VARIANT_KEY.test(k))).toBe(true);
    for (const bad of [`${key}.w321.webp`, `${key}.w320.png`, `../${key}.w320.webp`, `${key}.w320.webp/x`]) expect(VARIANT_KEY.test(bad), bad).toBe(false);
  });
});
