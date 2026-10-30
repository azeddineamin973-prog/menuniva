import 'server-only';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** 256-bit random token, URL-safe. Used for sessions, invitations, resets. */
export function newSecretToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** 128-bit random public token (QR codes, order tracking). Unguessable, not a DB id. */
export function newPublicToken(): string {
  return randomBytes(16).toString('base64url');
}

/** Tokens are stored only as SHA-256 hashes, so a database leak does not reveal them. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
