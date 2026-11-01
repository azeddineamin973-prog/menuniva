import 'server-only';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { MEDIA_FORMATS, MEDIA_WIDTHS, type MediaFormat, type MediaWidth } from '@/lib/media';
import { newPublicToken } from './crypto';
import { env } from './env';

/**
 * File storage for restaurant images (logos, covers, dish photos).
 *
 * - `local` (default, development/tests): files under UPLOAD_DIR.
 * - `supabase`: a private Supabase Storage bucket, reached only from the server with the
 *   secret key. Browsers never talk to Supabase: images are served by the app at /media/<key>.
 *
 * The database stores the app path `/media/<organizationId>/<branding|products>/<random>.<ext>`
 * for both drivers, so switching driver needs no data migration.
 */
export interface FileStorage {
  readonly driver: 'local' | 'supabase';
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  /** Returns null when the object does not exist. Throws on configuration/network errors. */
  get(key: string): Promise<Buffer | null>;
  /** Idempotent: deleting a missing object succeeds. */
  delete(key: string): Promise<void>;
  /** Deletes several objects (one request where the driver allows it). Missing ones are fine. */
  deleteMany(keys: string[]): Promise<void>;
}

/** Shape of every key MenuNiva creates. Anything else is refused by every driver and by /media. */
export const MEDIA_KEY = /^[a-z0-9]+\/(branding|products)\/[A-Za-z0-9_-]{22}\.(png|jpg|webp)$/;
/**
 * A resized copy of an original: `<original key>.w<width>.<avif|webp>`, stored next to it. Only
 * the server creates these (see media-variants.ts); /media never accepts them as a path.
 */
export const VARIANT_KEY = new RegExp(`^[a-z0-9]+\\/(branding|products)\\/[A-Za-z0-9_-]{22}\\.(png|jpg|webp)\\.w(${MEDIA_WIDTHS.join('|')})\\.(${MEDIA_FORMATS.join('|')})$`);
export function variantKey(key: string, width: MediaWidth, format: MediaFormat) {
  return `${key}.w${width}.${format}`;
}
/** Every variant key an original can have (for deleting them with it). */
export function variantKeys(key: string) {
  return MEDIA_WIDTHS.flatMap((w) => MEDIA_FORMATS.map((f) => variantKey(key, w, f)));
}
const isStorageKey = (key: string) => MEDIA_KEY.test(key) || VARIANT_KEY.test(key);

class LocalDiskStorage implements FileStorage {
  readonly driver = 'local' as const;
  constructor(private root: string) {}
  private resolve(key: string) {
    const full = path.resolve(this.root, key);
    if (!full.startsWith(path.resolve(this.root) + path.sep)) throw new Error('Invalid storage key');
    return full;
  }
  async put(key: string, data: Buffer) {
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, data, { flag: 'wx' });
  }
  async get(key: string) {
    try {
      return await readFile(this.resolve(key));
    } catch {
      return null;
    }
  }
  async delete(key: string) {
    try {
      await unlink(this.resolve(key));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
  }
  async deleteMany(keys: string[]) {
    for (const key of keys) await this.delete(key);
  }
}

export class StorageServiceError extends Error {}

/** Supabase Storage over its REST API (https://supabase.com/docs/reference/api → Storage). */
export class SupabaseStorage implements FileStorage {
  readonly driver = 'supabase' as const;
  private base: string;
  constructor(
    projectUrl: string,
    private secretKey: string,
    private bucket: string,
    private fetchImpl: typeof fetch = fetch,
    /** Folder in the bucket that holds every object, e.g. `test-tmp/run-1/` (empty in production). */
    private prefix = '',
  ) {
    this.base = `${projectUrl.replace(/\/+$/, '')}/storage/v1/object`;
  }
  /** Name of the object inside the bucket. */
  objectName(key: string) {
    if (!isStorageKey(key)) throw new Error('Invalid storage key');
    return `${this.prefix}${key}`;
  }
  private headers(extra: Record<string, string> = {}) {
    // New secret keys (sb_secret_…) are not JWTs and go in `apikey` only; the legacy
    // service_role JWT is also sent as a bearer token.
    const h: Record<string, string> = { apikey: this.secretKey, ...extra };
    if (this.secretKey.startsWith('eyJ')) h.Authorization = `Bearer ${this.secretKey}`;
    return h;
  }
  private objectPath(key: string) {
    return `${encodeURIComponent(this.bucket)}/${this.objectName(key).split('/').map(encodeURIComponent).join('/')}`;
  }
  private async fail(op: string, res: Response): Promise<never> {
    const body = await res.text().catch(() => '');
    // The response never contains the key; keep the message short for logs.
    throw new StorageServiceError(`Supabase Storage ${op} failed: HTTP ${res.status} ${body.slice(0, 200)}`);
  }
  async put(key: string, data: Buffer, contentType: string) {
    const res = await this.fetchImpl(`${this.base}/${this.objectPath(key)}`, {
      method: 'POST',
      headers: this.headers({ 'Content-Type': contentType, 'x-upsert': 'false', 'cache-control': 'max-age=31536000' }),
      body: new Uint8Array(data),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) await this.fail('upload', res);
  }
  async get(key: string) {
    if (!isStorageKey(key)) return null;
    const res = await this.fetchImpl(`${this.base}/authenticated/${this.objectPath(key)}`, {
      headers: this.headers(),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    if (res.status === 404) return null;
    if (res.status === 400) {
      // Older Storage versions answer "not found" as HTTP 400 with statusCode "404" in the body.
      const body = (await res.json().catch(() => null)) as { statusCode?: string; error?: string } | null;
      if (body?.statusCode === '404' || body?.error === 'not_found') return null;
      throw new StorageServiceError(`Supabase Storage download failed: HTTP 400 ${body?.error ?? ''}`);
    }
    return this.fail('download', res);
  }
  async delete(key: string) {
    await this.deleteMany([key]);
  }
  async deleteMany(keys: string[]) {
    if (keys.length === 0) return;
    const names = keys.map((k) => this.objectName(k)); // validates every key
    const res = await this.fetchImpl(`${this.base}/${encodeURIComponent(this.bucket)}`, {
      method: 'DELETE',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ prefixes: names }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) await this.fail('delete', res);
  }
}

function createStorage(): FileStorage {
  if (env.STORAGE_DRIVER === 'supabase')
    return new SupabaseStorage(env.SUPABASE_URL!, env.SUPABASE_SECRET_KEY!, env.SUPABASE_STORAGE_BUCKET, fetch, env.SUPABASE_STORAGE_PREFIX);
  return new LocalDiskStorage(path.resolve(env.UPLOAD_DIR));
}

export const storage: FileStorage = createStorage();

export type ImageKind = { ext: 'png' | 'jpg' | 'webp'; contentType: string };

/** Identifies images by their magic bytes, never by file name or browser-supplied type. SVG is rejected (can contain scripts). */
export function sniffImage(buf: Buffer): ImageKind | null {
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: 'png', contentType: 'image/png' };
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: 'jpg', contentType: 'image/jpeg' };
  if (buf.length > 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP')
    return { ext: 'webp', contentType: 'image/webp' };
  return null;
}

export class UploadError extends Error {}

/** Validates and stores an uploaded image for a tenant. Returns the media path saved in the database. */
export async function storeTenantImage(organizationId: string, file: File, folder: 'branding' | 'products'): Promise<string> {
  if (!(file instanceof File) || file.size === 0) throw new UploadError('no_file');
  if (file.size > env.UPLOAD_MAX_BYTES) throw new UploadError('file_too_large');
  const buf = Buffer.from(await file.arrayBuffer());
  const kind = sniffImage(buf);
  if (!kind) throw new UploadError('unsupported_type');
  if (!/^[a-z0-9]+$/i.test(organizationId)) throw new UploadError('invalid_tenant');
  const key = `${organizationId}/${folder}/${newPublicToken()}.${kind.ext}`;
  await storage.put(key, buf, kind.contentType);
  return `/media/${key}`;
}

/** The storage key inside a media path, or null for anything that is not a MenuNiva media path. */
export function mediaKeyFromPath(mediaPath: string | null | undefined): string | null {
  if (!mediaPath?.startsWith('/media/')) return null;
  const key = mediaPath.slice('/media/'.length);
  return MEDIA_KEY.test(key) ? key : null;
}

export const CONTENT_TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', avif: 'image/avif' };
