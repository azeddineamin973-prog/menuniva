export type DatabasePoolConfig = { connectionString: string; max: number; connectionTimeoutMillis: number; idleTimeoutMillis: number; ssl?: { ca: string; rejectUnauthorized: true } };

/**
 * A request waits at most 10 s for a database connection (all busy, or the database/pooler
 * unreachable) and then fails with an error page, instead of hanging until the host kills it.
 * Idle connections close after 10 s so suspended serverless instances do not hold pooler slots.
 */
const TIMEOUTS = { connectionTimeoutMillis: 10_000, idleTimeoutMillis: 10_000 } as const;

/**
 * node-postgres settings for the app's database connection.
 *
 * `caCert` (DATABASE_CA_CERT) is the database provider's root CA, as PEM text or base64 of the PEM.
 * Hosts without a writable/committed certificate file (e.g. Vercel) pass it as a variable. When it
 * is set, TLS is required and the server certificate is verified against it; TLS options in the URL
 * are removed because node-postgres lets URL options override the `ssl` object.
 */
export function databasePoolConfig(url: string, caCert: string | undefined, max: number): DatabasePoolConfig {
  if (!caCert?.trim()) return { connectionString: url, max, ...TIMEOUTS };
  const pem = caCert.includes('-----BEGIN CERTIFICATE-----') ? caCert.replace(/\\n/g, '\n') : Buffer.from(caCert.trim(), 'base64').toString('utf8');
  if (!pem.includes('-----BEGIN CERTIFICATE-----')) throw new Error('DATABASE_CA_CERT: not a PEM certificate (or base64 of one)');
  const u = new URL(url);
  for (const p of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'ssl', 'sslaccept', 'uselibpqcompat']) u.searchParams.delete(p);
  return { connectionString: u.toString(), max, ...TIMEOUTS, ssl: { ca: pem, rejectUnauthorized: true } };
}
