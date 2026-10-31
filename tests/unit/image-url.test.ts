import { describe, expect, it } from 'vitest';
import { displayImageUrl, sizedImageUrl, THUMBNAIL_WIDTH } from '@/lib/image-url';
import { mediaKeyFromPath } from '@/server/storage';

const DH = 'https://images.deliveryhero.io/image/global-menu-service/GV_PT/vendor/1/product/test.jpg';

describe('photo addresses for import previews and copies', () => {
  it('asks the Glovo image CDN for the size it needs', () => {
    expect(sizedImageUrl(DH, THUMBNAIL_WIDTH)).toBe(`${DH}?width=160`);
    // An existing width is replaced, not duplicated.
    expect(sizedImageUrl(`${DH}?width=800`, 1000)).toBe(`${DH}?width=1000`);
  });

  it('leaves other https hosts untouched', () => {
    expect(sizedImageUrl('https://cdn.example.test/a.jpg?v=2', 160)).toBe('https://cdn.example.test/a.jpg?v=2');
  });

  it('never returns an insecure or malformed address', () => {
    expect(sizedImageUrl('http://images.deliveryhero.io/a.jpg', 160)).toBeNull();
    expect(sizedImageUrl('javascript:alert(1)', 160)).toBeNull();
    expect(sizedImageUrl('not a url', 160)).toBeNull();
    expect(sizedImageUrl('https://user:pass@cdn.example.test/a.jpg', 160)).toBeNull();
    expect(sizedImageUrl(null, 160)).toBeNull();
    expect(sizedImageUrl('', 160)).toBeNull();
  });
});

describe('showing photos in the browser', () => {
  const own = '/media/cmorg123/products/AbCdEfGhIjKlMnOpQrStUv.jpg';

  it('shows MenuNiva’s own photos as they are, and resizes platform photos', () => {
    expect(displayImageUrl(own, THUMBNAIL_WIDTH)).toBe(own);
    expect(displayImageUrl(DH, THUMBNAIL_WIDTH)).toBe(`${DH}?width=160`);
  });

  it('accepts exactly the paths the server can store, nothing else', () => {
    const cases = [
      own,
      '/media/cmorg123/branding/AbCdEfGhIjKlMnOpQrStUv.png',
      '/media/cmorg123/products/short.jpg',
      '/media/../etc/AbCdEfGhIjKlMnOpQrStUv.jpg',
      '/media/cmorg123/products/AbCdEfGhIjKlMnOpQrStUv.svg',
      '/other/cmorg123/products/AbCdEfGhIjKlMnOpQrStUv.jpg',
      '//evil.example/a.jpg',
    ];
    for (const c of cases) expect(displayImageUrl(c, 160) === c).toBe(mediaKeyFromPath(c) !== null);
    expect(displayImageUrl('//evil.example/a.jpg', 160)).toBeNull();
  });
});
