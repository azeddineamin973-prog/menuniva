import { beforeEach, describe, expect, it } from 'vitest';
import { resetPasswordAction } from '@/app/(auth)/actions';
import { verifyPassword } from '@/server/auth/password';
import { createPasswordResetLink } from '@/server/auth/reset';
import { db } from '@/server/db';
import { sniffImage, storage, storeTenantImage, UploadError } from '@/server/storage';
import { createTestUser, resetDatabase } from '../support/db';

const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBPVP8 ')]);

describe('M3-05 safe uploads', () => {
  it('identifies images by content, never by name', () => {
    expect(sniffImage(PNG)?.ext).toBe('png');
    expect(sniffImage(JPEG)?.ext).toBe('jpg');
    expect(sniffImage(WEBP)?.ext).toBe('webp');
    expect(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).toBeNull();
    expect(sniffImage(Buffer.from('<html><body>hi</body></html>'))).toBeNull();
  });

  it('stores valid images under a random name and rejects SVG renamed to .png and oversized files', async () => {
    const url = await storeTenantImage('testorg1', new File([PNG], 'logo.png', { type: 'image/png' }), 'branding');
    expect(url).toMatch(/^\/media\/testorg1\/branding\/[A-Za-z0-9_-]{22}\.png$/);
    expect(await storage.get(url.replace('/media/', ''))).toEqual(PNG);
    await expect(storeTenantImage('testorg1', new File(['<svg/>'], 'evil.png', { type: 'image/png' }), 'branding')).rejects.toMatchObject({ message: 'unsupported_type' });
    const big = new File([Buffer.concat([PNG, Buffer.alloc(6 * 1024 * 1024)])], 'big.png', { type: 'image/png' });
    await expect(storeTenantImage('testorg1', big, 'branding')).rejects.toBeInstanceOf(UploadError);
    await expect(storeTenantImage('../etc', new File([PNG], 'x.png'), 'branding')).rejects.toMatchObject({ message: 'invalid_tenant' });
  });

  it('storage refuses path traversal keys', async () => {
    await expect(storage.put('../../outside.png', PNG, 'image/png')).rejects.toThrow(/Invalid storage key/);
  });
});

describe('M2-14 password reset', () => {
  beforeEach(resetDatabase);

  function form(token: string, password: string) {
    const f = new FormData();
    f.set('token', token);
    f.set('password', password);
    return f;
  }

  it('single-use link changes the password and revokes all sessions', async () => {
    const user = await createTestUser();
    await db.session.create({ data: { userId: user.id, tokenHash: 'h1', expiresAt: new Date(Date.now() + 86400_000) } });
    const link = await createPasswordResetLink(user.id);
    const token = link.split('/reset-password/')[1];
    const ok = await resetPasswordAction({ ok: false, error: '' }, form(token, 'brand-new-password-1'));
    expect(ok.ok).toBe(true);
    const updated = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(await verifyPassword(updated.passwordHash, 'brand-new-password-1')).toBe(true);
    expect(await db.session.count({ where: { userId: user.id } })).toBe(0);
    const again = await resetPasswordAction({ ok: false, error: '' }, form(token, 'another-password-22'));
    expect(again).toMatchObject({ ok: false, error: 'link_invalid' });
  });

  it('rejects expired links and short passwords', async () => {
    const user = await createTestUser();
    const link = await createPasswordResetLink(user.id);
    const token = link.split('/reset-password/')[1];
    expect(await resetPasswordAction({ ok: false, error: '' }, form(token, 'short'))).toMatchObject({ ok: false, error: 'validation' });
    await db.passwordResetToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await resetPasswordAction({ ok: false, error: '' }, form(token, 'brand-new-password-1'))).toMatchObject({ ok: false, error: 'link_invalid' });
  });
});
