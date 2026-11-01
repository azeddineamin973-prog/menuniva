/**
 * Random RFC 4122 version-4 id (idempotency keys, cart lines). `crypto.randomUUID` only exists on
 * https pages and localhost; on a plain-http address (a phone testing the app over the local
 * network) the same kind of id is built from `crypto.getRandomValues`, which works everywhere.
 * The server accepts only real UUIDs, so a home-made fallback would make orders fail there.
 */
export function uuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
