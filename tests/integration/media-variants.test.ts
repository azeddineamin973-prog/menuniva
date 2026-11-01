import { afterAll, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { GET as mediaRoute } from '@/app/media/[...key]/route';
import { deleteTenantMedia } from '@/server/media';
import { storage, StorageServiceError, variantKey } from '@/server/storage';

/**
 * Right-sized AVIF/WebP copies served by /media (local storage driver, test upload folder).
 * The originals are never changed; copies are made once, stored, and deleted with their photo.
 */
const ORG = 'cmvariantstest';
const created: string[] = [];
const token = () => Math.random().toString(36).slice(2).padEnd(22, 'x').slice(0, 22);
async function put(buf: Buffer, ext: 'jpg' | 'png') {
  const key = `${ORG}/products/${token()}.${ext}`;
  await storage.put(key, buf, ext === 'jpg' ? 'image/jpeg' : 'image/png');
  created.push(key);
  return key;
}
async function get(key: string, query = '') {
  const res = await mediaRoute(new Request(`http://localhost/media/${key}${query}`), { params: Promise.resolve({ key: key.split('/') }) });
  return { status: res.status, type: res.headers.get('content-type'), cache: res.headers.get('cache-control'), body: Buffer.from(await res.arrayBuffer()) };
}
/** Photo-like content (noise compresses like a real photo), with optional EXIF orientation. */
async function photo(width: number, height: number, opts: { orientation?: number; alpha?: boolean } = {}) {
  const channels = opts.alpha ? 4 : 3;
  const raw = Buffer.alloc(width * height * channels);
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 2654435761) >>> 24;
  if (opts.alpha) for (let i = 3; i < raw.length; i += 4) raw[i] = i % 8 === 3 ? 0 : 255;
  const img = sharp(raw, { raw: { width, height, channels } }).blur(1);
  if (opts.alpha) return img.png().toBuffer();
  return img.withMetadata({ orientation: opts.orientation ?? 1, exif: { IFD0: { Copyright: 'menuniva-test' } } }).jpeg({ quality: 90 }).toBuffer();
}

afterAll(async () => {
  await storage.deleteMany(created.flatMap((k) => [k, variantKey(k, 320, 'webp'), variantKey(k, 320, 'avif'), variantKey(k, 640, 'webp'), variantKey(k, 1920, 'webp')]));
});

describe('photo variants on /media', () => {
  it('serves a resized WebP and AVIF copy, stores it once, and leaves the original untouched', async () => {
    const original = await photo(1200, 900);
    const key = await put(original, 'jpg');
    const putSpy = vi.spyOn(storage, 'put');
    for (const f of ['webp', 'avif'] as const) {
      const r = await get(key, `?w=320&f=${f}`);
      expect(r.status).toBe(200);
      expect(r.type).toBe(`image/${f}`);
      expect(r.cache).toContain('immutable');
      const meta = await sharp(r.body).metadata();
      expect(meta.format).toBe(f === 'avif' ? 'heif' : 'webp');
      expect(meta.width).toBe(320);
      expect(r.body.length).toBeLessThan(original.length / 5);
    }
    expect(putSpy).toHaveBeenCalledTimes(2);
    // A second request reads the stored copy instead of encoding again.
    const again = await get(key, '?w=320&f=webp');
    expect(again.status).toBe(200);
    expect(putSpy).toHaveBeenCalledTimes(2);
    putSpy.mockRestore();
    // The plain address still returns the original bytes.
    const plain = await get(key);
    expect(plain.type).toBe('image/jpeg');
    expect(plain.body.equals(original)).toBe(true);
    expect((await storage.get(key))!.equals(original)).toBe(true);
  });

  it('follows the EXIF orientation, drops metadata and never upscales', async () => {
    // A portrait photo saved sideways by a phone camera (orientation 6 = rotate 90°).
    const key = await put(await photo(400, 300, { orientation: 6 }), 'jpg');
    const r = await get(key, '?w=1920&f=webp');
    const meta = await sharp(r.body).metadata();
    expect([meta.width, meta.height]).toEqual([300, 400]); // upright, and not enlarged
    expect(meta.exif).toBeUndefined();
    expect(meta.orientation).toBeUndefined();
  });

  it('keeps transparency of logos', async () => {
    const key = await put(await photo(600, 600, { alpha: true }), 'png');
    const r = await get(key, '?w=320&f=webp');
    expect(r.type).toBe('image/webp');
    expect((await sharp(r.body).metadata()).hasAlpha).toBe(true);
  });

  it('refuses unknown sizes and formats, and falls back to the original when a file cannot be decoded', async () => {
    const key = await put(await photo(800, 600), 'jpg');
    for (const q of ['?w=321&f=webp', '?w=320&f=png', '?w=320', '?f=avif', '?w=abc&f=webp']) expect((await get(key, q)).status, q).toBe(400);
    const broken = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]), Buffer.from('JFIF not really a photo')]);
    const bad = await put(broken, 'jpg');
    const r = await get(bad, '?w=320&f=avif');
    expect(r.status).toBe(200);
    expect(r.type).toBe('image/jpeg');
    expect(r.body.equals(broken)).toBe(true);
    expect(await storage.get(variantKey(bad, 320, 'avif'))).toBeNull(); // nothing stored for it
    expect((await get(`${ORG}/products/${token()}.jpg`, '?w=320&f=webp')).status).toBe(404);
  });

  it('a deleted photo is not served at any size', async () => {
    const key = await put(await photo(1000, 800), 'jpg');
    expect((await get(key, '?w=640&f=webp')).status).toBe(200);
    expect(await storage.get(variantKey(key, 640, 'webp'))).not.toBeNull();
    await deleteTenantMedia(ORG, [`/media/${key}`], { force: true });
    expect((await get(key)).status).toBe(404);
    expect((await get(key, '?w=640&f=webp')).status).toBe(404);
    expect(await storage.get(variantKey(key, 640, 'webp'))).toBeNull();
  });

  // Keep last: it switches this test process to WebP answers for AVIF requests.
  it('a bucket that refuses AVIF files gets WebP copies instead of an encode on every request', async () => {
    const key = await put(await photo(1000, 800), 'jpg');
    const realPut = storage.put.bind(storage);
    // What a Supabase bucket limited to PNG/JPEG/WebP answers (docs/DEPLOYMENT.md asks for AVIF too).
    const putSpy = vi.spyOn(storage, 'put').mockImplementation(async (k, data, type) => {
      if (type === 'image/avif') throw new StorageServiceError('Supabase Storage upload failed: HTTP 400 {"statusCode":"415","error":"invalid_mime_type","message":"mime type image/avif is not supported"}');
      return realPut(k, data, type);
    });
    try {
      // First request: the AVIF copy just made is still served, although it could not be stored.
      const first = await get(key, '?w=320&f=avif');
      expect(first.type).toBe('image/avif');
      expect(await storage.get(variantKey(key, 320, 'avif'))).toBeNull();
      // From then on this process answers with the WebP copy, stored once and reused.
      const second = await get(key, '?w=320&f=avif');
      expect(second.type).toBe('image/webp');
      expect((await sharp(second.body).metadata()).width).toBe(320);
      expect(await storage.get(variantKey(key, 320, 'webp'))).not.toBeNull();
      const puts = putSpy.mock.calls.length;
      expect((await get(key, '?w=320&f=avif')).type).toBe('image/webp');
      expect(putSpy.mock.calls.length).toBe(puts);
    } finally {
      putSpy.mockRestore();
    }
  });
});
