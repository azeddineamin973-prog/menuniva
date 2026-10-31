import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/server/db';
import { cancelImport, getImportPreview, publishImport, setImportedProductPhoto, startImport } from '@/server/import/service';
import { getPublicMenu } from '@/server/services/public-menu';
import { arrangeProductImage, MAX_PRODUCT_IMAGES, removeProductImage, uploadProductImage } from '@/server/services/menu';
import { mediaKeyFromPath, storage } from '@/server/storage';
import { resetDatabase } from '../support/db';
import { createOrderingFixture } from '../support/fixtures';
import { buildGlovoStorePage } from '../support/glovo-page';

/**
 * Changing dish photos: in import review and on the menu. Fictitious "Test …" restaurants in the
 * TEST database; photos go to local test storage (vitest.config.ts). No network.
 */

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489', 'hex');
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
const file = (buf: Buffer, name = 'photo.png', type = 'image/png') => new File([new Uint8Array(buf)], name, { type });
const exists = async (url: string | null) => !!(url && (await storage.get(mediaKeyFromPath(url)!)));

const PAGE = buildGlovoStorePage([
  {
    title: 'Pratos foto teste',
    products: [
      { name: 'Tajine foto teste', price: 12.9, imageId: 'dh:menus-glovo/products/foto1' },
      { name: 'Cuscuz foto teste', price: 11.5 },
    ],
  },
]);
const GLOVO_PHOTO = 'https://images.deliveryhero.io/image/menus-glovo/products/foto1?width=800';

async function reviewItem(f: Awaited<ReturnType<typeof createOrderingFixture>>, name: string) {
  const { jobId } = await startImport(f.ctx, { type: 'GLOVO', text: PAGE });
  const p = await getImportPreview(f.ctx, jobId);
  return { jobId, item: p.products.find((x) => x.name === name)! };
}
const stations = async (f: Awaited<ReturnType<typeof createOrderingFixture>>, jobId: string) =>
  Object.fromEntries((await getImportPreview(f.ctx, jobId)).stationTargets.map((t) => [t.label, f.kitchen.id]));

describe('changing a photo during import review', () => {
  beforeEach(resetDatabase);

  it('upload replaces the Glovo photo, restore brings it back, remove leaves none', async () => {
    const f = await createOrderingFixture();
    const { jobId, item } = await reviewItem(f, 'Tajine foto teste');
    expect(item.imageUrl).toBe(GLOVO_PHOTO);

    const up = await setImportedProductPhoto(f.ctx, jobId, item.id, { action: 'upload', file: file(PNG), rightsConfirmed: true });
    expect(up.imageUrl).toMatch(new RegExp(`^/media/${f.org.id}/products/[A-Za-z0-9_-]{22}\\.png$`));
    expect(up.sourceImageUrl).toBe(GLOVO_PHOTO);
    expect(await exists(up.imageUrl)).toBe(true);

    // A second upload replaces the first, whose file is deleted.
    const up2 = await setImportedProductPhoto(f.ctx, jobId, item.id, { action: 'upload', file: file(JPEG, 'b.jpg', 'image/jpeg'), rightsConfirmed: true });
    expect(up2.imageUrl).toMatch(/\.jpg$/);
    expect(await exists(up.imageUrl)).toBe(false);

    const back = await setImportedProductPhoto(f.ctx, jobId, item.id, { action: 'restore' });
    expect(back.imageUrl).toBe(GLOVO_PHOTO);
    expect(await exists(up2.imageUrl)).toBe(false);

    const none = await setImportedProductPhoto(f.ctx, jobId, item.id, { action: 'remove' });
    expect(none.imageUrl).toBeNull();
    // The Glovo photo can still be restored after removing it.
    expect((await setImportedProductPhoto(f.ctx, jobId, item.id, { action: 'restore' })).imageUrl).toBe(GLOVO_PHOTO);
  });

  it('a product without a source photo can get one, and cannot "restore" what never existed', async () => {
    const f = await createOrderingFixture();
    const { jobId, item } = await reviewItem(f, 'Cuscuz foto teste');
    expect(item.imageUrl).toBeNull();
    await expect(setImportedProductPhoto(f.ctx, jobId, item.id, { action: 'restore' })).rejects.toThrow(/did not provide a photo/);
    const up = await setImportedProductPhoto(f.ctx, jobId, item.id, { action: 'upload', file: file(PNG), rightsConfirmed: true });
    expect(await exists(up.imageUrl)).toBe(true);
  });

  it('refuses uploads without rights, that are not images, or from another restaurant', async () => {
    const a = await createOrderingFixture('Test Foto A');
    const b = await createOrderingFixture('Test Foto B');
    const { jobId, item } = await reviewItem(b, 'Tajine foto teste');
    await expect(setImportedProductPhoto(b.ctx, jobId, item.id, { action: 'upload', file: file(PNG), rightsConfirmed: false })).rejects.toThrow(/right to publish/);
    await expect(setImportedProductPhoto(b.ctx, jobId, item.id, { action: 'upload', file: file(Buffer.from('<svg onload=alert(1)>'), 'x.png'), rightsConfirmed: true })).rejects.toThrow('unsupported_type');
    await expect(setImportedProductPhoto(b.ctx, jobId, item.id, { action: 'upload', file: null, rightsConfirmed: true })).rejects.toThrow(/choose a photo/);
    await expect(setImportedProductPhoto(a.ctx, jobId, item.id, { action: 'remove' })).rejects.toThrow(/not found/i);
    // Nothing changed.
    expect((await db.importedProduct.findUniqueOrThrow({ where: { id: item.id } })).imageUrl).toBe(GLOVO_PHOTO);
  });

  it('saving the import attaches your own photo directly, without the platform-photo checkbox', async () => {
    const f = await createOrderingFixture();
    const { jobId, item } = await reviewItem(f, 'Tajine foto teste');
    const up = await setImportedProductPhoto(f.ctx, jobId, item.id, { action: 'upload', file: file(PNG), rightsConfirmed: true });

    const res = await publishImport(f.ctx, jobId, { confirm: true, imageRights: false, stations: await stations(f, jobId) });
    expect(res).toMatchObject({ created: 2, ownPhotos: 1, imagesRequested: 0 });
    const dish = await db.menuProduct.findFirstOrThrow({ where: { organizationId: f.org.id, translations: { some: { name: 'Tajine foto teste' } } }, include: { images: true } });
    expect(dish.images).toEqual([expect.objectContaining({ url: up.imageUrl, rightsConfirmed: true, origin: 'MANUAL' })]);
    expect(await exists(up.imageUrl)).toBe(true);
    // Once on a dish, the photo can no longer be changed through the closed import.
    await expect(setImportedProductPhoto(f.ctx, jobId, item.id, { action: 'remove' })).rejects.toThrow(/closed/);
  });

  it('photos uploaded for skipped products or cancelled imports are deleted', async () => {
    const f = await createOrderingFixture();
    const one = await reviewItem(f, 'Tajine foto teste');
    const kept = await setImportedProductPhoto(f.ctx, one.jobId, one.item.id, { action: 'upload', file: file(PNG), rightsConfirmed: true });
    await cancelImport(f.ctx, one.jobId);
    expect(await exists(kept.imageUrl)).toBe(false);

    const two = await reviewItem(f, 'Cuscuz foto teste');
    const skipped = await setImportedProductPhoto(f.ctx, two.jobId, two.item.id, { action: 'upload', file: file(PNG), rightsConfirmed: true });
    await db.importReviewDecision.update({ where: { jobId_importedProductId: { jobId: two.jobId, importedProductId: two.item.id } }, data: { decision: 'SKIP', decidedById: f.ctx.userId } });
    await publishImport(f.ctx, two.jobId, { confirm: true, stations: await stations(f, two.jobId) });
    expect(await exists(skipped.imageUrl)).toBe(false);
  });
});

describe('changing a dish photo on the menu', () => {
  beforeEach(resetDatabase);

  it('a new upload becomes the photo guests see; the old one stays as an extra', async () => {
    const f = await createOrderingFixture();
    await uploadProductImage(f.ctx, f.dish.id, file(PNG, 'old.png'), true);
    const guest = async () => (await getPublicMenu(f.location.id, 'pt', 'TABLE')).flatMap((c) => c.products).find((p) => p.id === f.dish.id)!.imageUrl;
    const old = await guest();
    expect(old).toMatch(/\.png$/);

    await uploadProductImage(f.ctx, f.dish.id, file(JPEG, 'new.jpg', 'image/jpeg'), true);
    const now = await guest();
    expect(now).toMatch(/\.jpg$/);
    const all = await db.productImage.findMany({ where: { productId: f.dish.id }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
    expect(all.map((i) => i.url)).toEqual([now, old]);

    // "Add as an extra photo" keeps the main photo.
    await uploadProductImage(f.ctx, f.dish.id, file(PNG, 'extra.png'), true, { main: false });
    expect(await guest()).toBe(now);
  });

  it('make main, move and remove change what guests see', async () => {
    const f = await createOrderingFixture();
    for (const n of ['a', 'b', 'c']) await uploadProductImage(f.ctx, f.dish.id, file(PNG, `${n}.png`), true, { main: false });
    const order = async () => (await db.productImage.findMany({ where: { productId: f.dish.id }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] })).map((i) => i.id);
    const [a, b, c] = await order();

    await arrangeProductImage(f.ctx, c, 'main');
    expect(await order()).toEqual([c, a, b]);
    await arrangeProductImage(f.ctx, a, 'right');
    expect(await order()).toEqual([c, b, a]);
    await arrangeProductImage(f.ctx, a, 'right'); // already last: nothing happens
    expect(await order()).toEqual([c, b, a]);
    await arrangeProductImage(f.ctx, b, 'left');
    expect(await order()).toEqual([b, c, a]);

    const mainUrl = (await db.productImage.findUniqueOrThrow({ where: { id: b } })).url;
    await removeProductImage(f.ctx, b);
    expect(await exists(mainUrl)).toBe(false);
    const guest = (await getPublicMenu(f.location.id, 'pt', 'TABLE')).flatMap((x) => x.products).find((p) => p.id === f.dish.id)!;
    expect(guest.imageUrl).toBe((await db.productImage.findUniqueOrThrow({ where: { id: c } })).url);
  });

  it('limits photos per dish and keeps other restaurants out', async () => {
    const a = await createOrderingFixture('Test Foto Menu A');
    const b = await createOrderingFixture('Test Foto Menu B');
    for (let i = 0; i < MAX_PRODUCT_IMAGES; i++) await uploadProductImage(a.ctx, a.dish.id, file(PNG, `${i}.png`), true, { main: false });
    await expect(uploadProductImage(a.ctx, a.dish.id, file(PNG), true)).rejects.toThrow(new RegExp(`up to ${MAX_PRODUCT_IMAGES} photos`));
    const img = await db.productImage.findFirstOrThrow({ where: { productId: a.dish.id } });
    await expect(arrangeProductImage(b.ctx, img.id, 'main')).rejects.toThrow(/not found/i);
    await expect(removeProductImage(b.ctx, img.id)).rejects.toThrow(/not found/i);
  });

  it('removing a photo from a dish never deletes a file an open import still uses', async () => {
    const f = await createOrderingFixture();
    const { jobId, item } = await reviewItem(f, 'Tajine foto teste');
    const up = await setImportedProductPhoto(f.ctx, jobId, item.id, { action: 'upload', file: file(PNG), rightsConfirmed: true });
    // Corrupt-data guard: a dish row pointing at the same file as the open review.
    const shared = await db.productImage.create({ data: { productId: f.dish.id, url: up.imageUrl!, rightsConfirmed: true } });
    await removeProductImage(f.ctx, shared.id);
    expect(await exists(up.imageUrl)).toBe(true);
  });
});
