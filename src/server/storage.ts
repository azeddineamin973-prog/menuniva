import 'server-only';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { newPublicToken } from './crypto';
import { env } from './env';

/**
 * File storage abstraction. Development uses the local disk (UPLOAD_DIR); production can
 * swap in an S3-compatible implementation with the same interface (docs/DEPLOYMENT.md).
 */
export interface FileStorage {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
}

class LocalDiskStorage implements FileStorage {
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
}

export const storage: FileStorage = new LocalDiskStorage(path.resolve(env.UPLOAD_DIR));

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

/** Validates and stores an uploaded image for a tenant. Returns the public media URL. */
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

export const CONTENT_TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };
