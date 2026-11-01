import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as mediaRoute } from '@/app/media/[...key]/route';
import { db } from '@/server/db';
import { deleteTenantMedia, withStoredImages } from '@/server/media';
import { addProductImage, removeProductImage, uploadProductImage } from '@/server/services/menu';
import { saveBrandingWithImages, updateBranding } from '@/server/services/settings';
import { storage } from '@/server/storage';
import { resetDatabase } from '../support/db';
import { createOrderingFixture } from '../support/fixtures';
import { makePng } from '../support/png';

/**
 * Image lifecycle (upload → display → replace → delete) and tenant isolation.
 * Runs against local files by default; against the real Supabase bucket with
 *   MEDIA_TEST_DRIVER=supabase npx vitest run tests/integration/media-storage.test.ts
 * Every object created here is deleted again in afterAll.
 */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]), Buffer.from('JFIF test jpeg')]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBPVP8 test webp')]);
const file = (buf: Buffer, name: string, type: string) => new File([new Uint8Array(buf)], name, { type });
const BRANDING = { themePreset: 'classic', primaryColor: '#2B2B2B', accentColor: '#C0392B', backgroundColor: '#FFFFFF', textColor: '#1A1A1A', headingFont: 'serif', tagline: '' };
const created = new Set<string>();
const putSpy = vi.spyOn(storage, 'put');
const key = (p: string | null | undefined) => p!.replace('/media/', '');

async function serve(path: string | null | undefined) {
  const k = key(path).split('/');
  const res = await mediaRoute(new Request(`http://localhost${path}`), { params: Promise.resolve({ key: k }) });
  return { status: res.status, type: res.headers.get('content-type'), body: Buffer.from(await res.arrayBuffer()) };
}
async function branding(orgId: string) {
  return db.restaurantBranding.findUnique({ where: { organizationId: orgId } });
}
let A: Awaited<ReturnType<typeof createOrderingFixture>>;
let B: Awaited<ReturnType<typeof createOrderingFixture>>;

beforeAll(() => {
  console.info(`[media-storage] driver: ${storage.driver}`);
});
beforeEach(async () => {
  for (const c of putSpy.mock.calls) created.add(c[0]);
  putSpy.mockClear();
  await resetDatabase();
  A = await createOrderingFixture('Test Restaurant A');
  B = await createOrderingFixture('Test Restaurant B');
});
afterAll(async () => {
  for (const c of putSpy.mock.calls) created.add(c[0]);
  for (const k of created) await storage.delete(k);
  for (const k of created) expect(await storage.get(k)).toBeNull();
  putSpy.mockRestore();
  if (storage.driver === 'supabase') {
    // The temporary folder is empty again (Supabase lists nothing under it).
    expect(await listFolder(PREFIX)).toEqual([]);
    console.info(`[media-storage] ${created.size} temporary objects created and deleted under ${PREFIX}`);
  }
});

// ---- Supabase-only helpers (server-side key read from the environment, never printed)
const SB_URL = process.env.SUPABASE_URL ?? '';
const SB_KEY = process.env.SUPABASE_SECRET_KEY ?? '';
const BUCKET = process.env.SUPABASE_STORAGE_BUCKET ?? 'restaurant-media';
const PREFIX = process.env.SUPABASE_STORAGE_PREFIX ?? '';
/** Recursively lists object names under a folder of the bucket. */
async function listFolder(folder: string): Promise<string[]> {
  const res = await fetch(`${SB_URL}/storage/v1/object/list/${BUCKET}`, {
    method: 'POST',
    headers: { apikey: SB_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefix: folder.replace(/\/$/, ''), limit: 1000 }),
  });
  expect(res.status).toBe(200);
  const entries = (await res.json()) as { name: string; id: string | null }[];
  const out: string[] = [];
  for (const e of entries) {
    const full = `${folder.replace(/\/?$/, '/')}${e.name}`;
    if (e.id) out.push(full);
    else out.push(...(await listFolder(full)));
  }
  return out;
}

describe.runIf(storage.driver === 'supabase')('Supabase Storage (live bucket)', () => {
  it('stores a real image only inside the temporary test folder, and reads it back', async () => {
    expect(PREFIX).toMatch(/^test-tmp\/[a-z0-9-]+\/$/);
    const real = makePng(64, 48, [200, 40, 40]);
    await saveBrandingWithImages(A.ctx, BRANDING, { logo: file(real, 'real-logo.png', 'image/png') });
    const logo = (await branding(A.org.id))!.logoUrl!;
    // The database keeps the app path; the bucket object lives under the test folder
    expect(logo).toMatch(new RegExp(`^/media/${A.org.id}/branding/`));
    expect(await listFolder(PREFIX)).toEqual([`${PREFIX}${key(logo)}`]);
    expect(await serve(logo)).toMatchObject({ status: 200, type: 'image/png', body: real });
  });

  it('the bucket is private: no anonymous, public-URL or fake-key access to an existing object', async () => {
    await saveBrandingWithImages(A.ctx, BRANDING, { logo: file(makePng(8, 8, [0, 0, 255]), 'l.png', 'image/png') });
    const name = `${PREFIX}${key((await branding(A.org.id))!.logoUrl)}`;
    const base = `${SB_URL}/storage/v1/object`;
    const attempts = [
      fetch(`${base}/public/${BUCKET}/${name}`), // public URL
      fetch(`${base}/authenticated/${BUCKET}/${name}`), // no key
      fetch(`${base}/${BUCKET}/${name}`), // no key, plain path
      fetch(`${base}/authenticated/${BUCKET}/${name}`, { headers: { apikey: 'sb_publishable_fake', Authorization: 'Bearer sb_publishable_fake' } }),
      fetch(`${SB_URL}/storage/v1/object/list/${BUCKET}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prefix: '' }) }),
    ];
    for (const res of await Promise.all(attempts)) {
      expect(res.ok).toBe(false);
      expect(res.headers.get('content-type') ?? '').not.toMatch(/^image\//);
    }
    // Uploading without the secret key is refused as well
    const anonUpload = await fetch(`${base}/${BUCKET}/${PREFIX}${A.org.id}/branding/AAAAAAAAAAAAAAAAAAAAAA.png`, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: new Uint8Array(PNG) });
    expect(anonUpload.ok).toBe(false);
  });

  it('bucket settings match docs/DEPLOYMENT.md: private, 5 MB, PNG/JPEG/WebP uploads plus AVIF copies', async () => {
    const bucket = await (await fetch(`${SB_URL}/storage/v1/bucket/${BUCKET}`, { headers: { apikey: SB_KEY } })).json();
    expect(bucket).toMatchObject({ public: false, file_size_limit: 5242880 });
    expect([...bucket.allowed_mime_types].sort()).toEqual(['image/avif', 'image/jpeg', 'image/png', 'image/webp']);
  });
});

describe('restaurant images: upload, display, replace, delete', () => {
  it('logo and cover: upload → shown at /media → replace (old file deleted) → remove', async () => {
    await saveBrandingWithImages(A.ctx, BRANDING, { logo: file(PNG, 'logo.png', 'image/png'), cover: file(JPEG, 'cover.jpg', 'image/jpeg') });
    const b1 = (await branding(A.org.id))!;
    // The database stores the media path, under this restaurant's own prefix
    expect(b1.logoUrl).toMatch(new RegExp(`^/media/${A.org.id}/branding/[A-Za-z0-9_-]{22}\\.png$`));
    expect(b1.coverUrl).toMatch(new RegExp(`^/media/${A.org.id}/branding/[A-Za-z0-9_-]{22}\\.jpg$`));
    expect(await storage.get(key(b1.logoUrl))).toEqual(PNG);
    // Display: served by the app with the right type and safety headers
    const shown = await serve(b1.logoUrl);
    expect(shown).toMatchObject({ status: 200, type: 'image/png' });
    expect(shown.body).toEqual(PNG);
    expect((await serve(b1.coverUrl)).type).toBe('image/jpeg');

    // Replace the logo: new path, old object gone, cover untouched
    await saveBrandingWithImages(A.ctx, BRANDING, { logo: file(WEBP, 'logo2.webp', 'image/webp') });
    const b2 = (await branding(A.org.id))!;
    expect(b2.logoUrl).not.toBe(b1.logoUrl);
    expect(b2.logoUrl).toMatch(/\.webp$/);
    expect(b2.coverUrl).toBe(b1.coverUrl);
    expect(await storage.get(key(b1.logoUrl))).toBeNull();
    expect((await serve(b1.logoUrl)).status).toBe(404);
    expect(await serve(b2.logoUrl)).toMatchObject({ status: 200, type: 'image/webp' });

    // Saving colours only keeps both images
    await saveBrandingWithImages(A.ctx, { ...BRANDING, primaryColor: '#111111' }, {});
    expect(await branding(A.org.id)).toMatchObject({ logoUrl: b2.logoUrl, coverUrl: b1.coverUrl, primaryColor: '#111111' });

    // Remove both
    await saveBrandingWithImages(A.ctx, { ...BRANDING, removeLogo: 'on', removeCover: 'on' }, {});
    expect(await branding(A.org.id)).toMatchObject({ logoUrl: null, coverUrl: null });
    expect(await storage.get(key(b2.logoUrl))).toBeNull();
    expect(await storage.get(key(b1.coverUrl))).toBeNull();
    const log = await db.auditLog.findMany({ where: { organizationId: A.org.id, action: 'settings.branding_updated' }, orderBy: { createdAt: 'asc' } });
    expect(log.map((l) => l.metadata)).toEqual([
      { logo: 'added', cover: 'added' },
      { logo: 'replaced', cover: null },
      { logo: null, cover: null },
      { logo: 'removed', cover: 'removed' },
    ]);
  });

  it('dish photo: upload → shown → replace (new photo, remove old) → delete', async () => {
    await uploadProductImage(A.ctx, A.dish.id, file(JPEG, 'dish.jpg', 'image/jpeg'), true);
    const [img1] = await db.productImage.findMany({ where: { productId: A.dish.id } });
    expect(img1.url).toMatch(new RegExp(`^/media/${A.org.id}/products/[A-Za-z0-9_-]{22}\\.jpg$`));
    expect(await serve(img1.url)).toMatchObject({ status: 200, type: 'image/jpeg' });

    await uploadProductImage(A.ctx, A.dish.id, file(PNG, 'dish2.png', 'image/png'), true);
    await removeProductImage(A.ctx, img1.id);
    const left = await db.productImage.findMany({ where: { productId: A.dish.id } });
    expect(left).toHaveLength(1);
    expect(await storage.get(key(img1.url))).toBeNull();
    expect((await serve(img1.url)).status).toBe(404);
    expect((await serve(left[0].url)).status).toBe(200);

    await removeProductImage(A.ctx, left[0].id);
    expect(await db.productImage.count({ where: { productId: A.dish.id } })).toBe(0);
    expect(await storage.get(key(left[0].url))).toBeNull();
  });

  it('nothing is stored for invalid input, and a failed save removes the file it just stored', async () => {
    await expect(saveBrandingWithImages(A.ctx, { ...BRANDING, primaryColor: 'red' }, { logo: file(PNG, 'l.png', 'image/png') })).rejects.toThrow();
    await expect(uploadProductImage(A.ctx, A.dish.id, file(PNG, 'd.png', 'image/png'), false)).rejects.toThrow(/right to publish/);
    await expect(uploadProductImage(A.ctx, A.dish.id, file(Buffer.from('<svg/>'), 'x.png', 'image/png'), true)).rejects.toThrow('unsupported_type');
    expect(putSpy).not.toHaveBeenCalled();

    let stored = '';
    await expect(
      withStoredImages(A.org.id, { x: { file: file(PNG, 'l.png', 'image/png'), folder: 'branding' } }, async (p) => {
        stored = p.x!;
        expect(await storage.get(key(stored))).toEqual(PNG);
        throw new Error('database unavailable');
      }),
    ).rejects.toThrow('database unavailable');
    expect(await storage.get(key(stored))).toBeNull();
  });

  it('a storage outage while deleting never fails the change (logged instead)', async () => {
    await uploadProductImage(A.ctx, A.dish.id, file(PNG, 'dish.png', 'image/png'), true);
    const img = await db.productImage.findFirstOrThrow({ where: { productId: A.dish.id } });
    // A photo goes with its resized copies in one request (deleteMany), for both drivers.
    const del = vi.spyOn(storage, 'deleteMany').mockRejectedValueOnce(new Error('storage down'));
    await removeProductImage(A.ctx, img.id);
    del.mockRestore();
    expect(await db.productImage.count({ where: { id: img.id } })).toBe(0);
    expect(await db.errorLog.count({ where: { source: 'media-delete' } })).toBe(1);
    await storage.delete(key(img.url));
  });
});

describe('tenant isolation: restaurant B cannot change restaurant A images', () => {
  async function seedA() {
    await saveBrandingWithImages(A.ctx, BRANDING, { logo: file(PNG, 'logo.png', 'image/png'), cover: file(JPEG, 'c.jpg', 'image/jpeg') });
    await uploadProductImage(A.ctx, A.dish.id, file(PNG, 'dish.png', 'image/png'), true);
    return { brand: (await branding(A.org.id))!, img: await db.productImage.findFirstOrThrow({ where: { productId: A.dish.id } }) };
  }
  async function expectAIntact(a: Awaited<ReturnType<typeof seedA>>) {
    expect(await branding(A.org.id)).toMatchObject({ logoUrl: a.brand.logoUrl, coverUrl: a.brand.coverUrl });
    expect(await db.productImage.findUnique({ where: { id: a.img.id } })).toMatchObject({ url: a.img.url, productId: A.dish.id });
    for (const p of [a.brand.logoUrl, a.brand.coverUrl, a.img.url]) expect((await serve(p)).status).toBe(200);
  }

  it('B cannot add a photo to, or remove a photo from, A’s dish', async () => {
    const a = await seedA();
    const before = putSpy.mock.calls.length;
    await expect(uploadProductImage(B.ctx, A.dish.id, file(PNG, 'x.png', 'image/png'), true)).rejects.toThrow(/not found/i);
    expect(putSpy.mock.calls.length).toBe(before); // refused before anything is stored
    await expect(removeProductImage(B.ctx, a.img.id)).rejects.toThrow(/not found/i);
    await expectAIntact(a);
  });

  it('B cannot point its own records at A’s files, or delete them', async () => {
    const a = await seedA();
    // A file path from the request is never trusted: link A's photo to B's dish → refused
    await expect(addProductImage(B.ctx, B.dish.id, a.img.url, true)).rejects.toThrow(/not found/i);
    // Branding form fields named logoUrl/coverUrl are ignored
    await updateBranding(B.ctx, { ...BRANDING, logoUrl: a.brand.logoUrl, coverUrl: a.brand.coverUrl });
    expect(await branding(B.org.id)).toMatchObject({ logoUrl: null, coverUrl: null });
    // Direct cleanup call with B's tenant id skips A's objects
    expect(await deleteTenantMedia(B.org.id, [a.brand.logoUrl, a.brand.coverUrl, a.img.url], { force: true })).toEqual([]);
    await expectAIntact(a);
  });

  it('even if B’s row referenced A’s file (corrupt data), B replacing or removing it never deletes A’s file', async () => {
    const a = await seedA();
    await db.restaurantBranding.upsert({ where: { organizationId: B.org.id }, update: { logoUrl: a.brand.logoUrl, coverUrl: a.brand.coverUrl }, create: { organizationId: B.org.id, logoUrl: a.brand.logoUrl, coverUrl: a.brand.coverUrl } });
    const bImage = await db.productImage.create({ data: { productId: B.dish.id, url: a.img.url, rightsConfirmed: true } });
    await saveBrandingWithImages(B.ctx, { ...BRANDING, removeCover: 'on' }, { logo: file(PNG, 'b.png', 'image/png') });
    await removeProductImage(B.ctx, bImage.id);
    const bb = (await branding(B.org.id))!;
    expect(bb.logoUrl).toMatch(new RegExp(`^/media/${B.org.id}/branding/`));
    expect(bb.coverUrl).toBeNull();
    await expectAIntact(a);
  });

  it('a file still referenced elsewhere is not deleted', async () => {
    const a = await seedA();
    expect(await deleteTenantMedia(A.org.id, [a.brand.logoUrl, a.img.url])).toEqual([]);
    await expectAIntact(a);
  });
});
