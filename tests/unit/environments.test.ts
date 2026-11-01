import { describe, expect, it } from 'vitest';
import { environmentProblems } from '@/server/env';

const SECRET = 'k3YqvW2bX9pLm4Rt7Zc1Nf8Hs6Jd0Ga5Eu2Oi9Qw';
const base = (APP_ENV: string, db: string, url = 'https://app.menuniva.example') => ({ APP_ENV: APP_ENV as never, APP_BASE_URL: url, DATABASE_URL: `postgresql://u:p@db.example:5432/${db}`, APP_SECRET: SECRET, TRUST_PROXY_HOPS: 1, DATABASE_CA_CERT: 'base64-of-the-ca' });

describe('M13-06 environments are kept apart', () => {
  it('accepts a correct setup for each environment', () => {
    expect(environmentProblems(base('production', 'menuniva_prod'))).toEqual([]);
    expect(environmentProblems(base('staging', 'menuniva_staging'))).toEqual([]);
    expect(environmentProblems(base('demo', 'menuniva_demo'))).toEqual([]);
    expect(environmentProblems(base('demo', 'menuniva_demo', 'http://localhost:3200'))).toEqual([]); // laptop demo
    expect(environmentProblems(base('development', 'menuniva_dev', 'http://localhost:3000'))).toEqual([]);
    expect(environmentProblems(base('test', 'menuniva_test', 'http://localhost:3100'))).toEqual([]);
  });
  it('refuses dangerous combinations', () => {
    expect(environmentProblems(base('production', 'menuniva_dev'))).toEqual([expect.stringContaining('must not use the "menuniva_dev" database')]);
    expect(environmentProblems(base('production', 'menuniva_staging'))).toEqual([expect.stringContaining('staging database')]);
    expect(environmentProblems(base('staging', 'menuniva_demo'))[0]).toMatch(/must not use/);
    expect(environmentProblems(base('demo', 'menuniva_prod'))[0]).toMatch(/separate database/);
    expect(environmentProblems(base('development', 'menuniva_test', 'http://localhost:3000'))[0]).toMatch(/wiped by automated tests/);
    expect(environmentProblems(base('production', 'menuniva_prod', 'http://app.example'))[0]).toMatch(/https/);
    expect(environmentProblems({ ...base('production', 'menuniva_prod'), APP_SECRET: 'replace-with-32-random-bytes-xxxxxxxx' })[0]).toMatch(/example value/);
    // audit BUG-05: a public deployment must declare its reverse proxies
    expect(environmentProblems({ ...base('production', 'menuniva_prod'), TRUST_PROXY_HOPS: undefined })[0]).toMatch(/TRUST_PROXY_HOPS/);
    expect(environmentProblems({ ...base('production', 'menuniva_prod'), TRUST_PROXY_HOPS: 0 })).toEqual([]);
  });
  it('a remote production or staging database must be reached over TLS', () => {
    const plain = { ...base('production', 'menuniva_prod'), DATABASE_CA_CERT: undefined };
    expect(environmentProblems(plain)[0]).toMatch(/needs TLS/);
    expect(environmentProblems({ ...base('staging', 'menuniva_staging'), DATABASE_CA_CERT: '' })[0]).toMatch(/needs TLS/);
    expect(environmentProblems({ ...plain, DATABASE_URL: 'postgresql://u:p@db.example:5432/menuniva_prod?sslmode=verify-full' })).toEqual([]);
    expect(environmentProblems({ ...plain, DATABASE_URL: 'postgresql://u:p@127.0.0.1:5432/menuniva_prod' })).toEqual([]); // same machine
    expect(environmentProblems({ ...base('development', 'menuniva_dev', 'http://localhost:3000'), DATABASE_CA_CERT: undefined })).toEqual([]);
  });
});
