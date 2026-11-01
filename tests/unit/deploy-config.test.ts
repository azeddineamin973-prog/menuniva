import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { databasePoolConfig } from '@/server/db-config';
import { withPlatformDefaults } from '@/server/env';

const PEM = '-----BEGIN CERTIFICATE-----\nMIIBtest\n-----END CERTIFICATE-----\n';
const URL_ = 'postgresql://u:p@aws-1-eu-central-1.pooler.supabase.com:6543/postgres?sslmode=require&sslrootcert=/x.crt&application_name=menuniva';

describe('database connection settings for hosts like Vercel', () => {
  it('without DATABASE_CA_CERT the URL is used unchanged (local development)', () => {
    // Requests never wait forever for a connection (pool exhausted, database or pooler down).
    const timeouts = { connectionTimeoutMillis: 10_000, idleTimeoutMillis: 10_000 };
    expect(databasePoolConfig(URL_, undefined, 10)).toEqual({ connectionString: URL_, max: 10, ...timeouts });
    expect(databasePoolConfig(URL_, '  ', 10)).toEqual({ connectionString: URL_, max: 10, ...timeouts });
    expect(databasePoolConfig(URL_, PEM, 3)).toMatchObject(timeouts);
  });
  it('with DATABASE_CA_CERT: verified TLS with that CA, and URL TLS options cannot override it', () => {
    for (const ca of [PEM, Buffer.from(PEM).toString('base64'), PEM.replace(/\n/g, '\\n')]) {
      const c = databasePoolConfig(URL_, ca, 3);
      expect(c.ssl).toEqual({ ca: PEM, rejectUnauthorized: true });
      expect(c.max).toBe(3);
      const u = new URL(c.connectionString!);
      expect([...u.searchParams.keys()]).toEqual(['application_name']);
      expect(u.password).toBe('p');
    }
  });
  it('refuses a value that is not a certificate', () => {
    expect(() => databasePoolConfig(URL_, 'not-a-cert', 3)).toThrow(/DATABASE_CA_CERT/);
  });
  it('the Supabase CA in certs/ is a PEM certificate (when present locally)', () => {
    let pem = '';
    try {
      pem = readFileSync('certs/supabase-root-2021-ca.crt', 'utf8');
    } catch {
      return;
    }
    expect(databasePoolConfig(URL_, Buffer.from(pem).toString('base64'), 3).ssl).toMatchObject({ ca: pem });
  });
});

describe('APP_BASE_URL on Vercel', () => {
  it('falls back to the production domain only when APP_BASE_URL is not set', () => {
    expect(withPlatformDefaults({ VERCEL_PROJECT_PRODUCTION_URL: 'menuniva.vercel.app' }).APP_BASE_URL).toBe('https://menuniva.vercel.app');
    expect(withPlatformDefaults({ APP_BASE_URL: 'https://app.example', VERCEL_PROJECT_PRODUCTION_URL: 'menuniva.vercel.app' }).APP_BASE_URL).toBe('https://app.example');
    expect(withPlatformDefaults({}).APP_BASE_URL).toBeUndefined();
  });
});
