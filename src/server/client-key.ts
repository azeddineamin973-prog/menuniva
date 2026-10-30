import 'server-only';
import { createHash } from 'node:crypto';

/** Privacy-friendly throttling key: a hash of IP + user agent (raw IPs are not stored). */
export function clientKeyFromRequest(req: Request): string {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'local';
  const ua = req.headers.get('user-agent') ?? '';
  return createHash('sha256').update(`${ip}|${ua}`).digest('hex').slice(0, 24);
}
