import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { expect, request as pwRequest, test } from '@playwright/test';
import { ROLE_PERMISSIONS } from '@/lib/permissions';
import { login, seed, type Seed } from './helpers';

/**
 * M13-01 runtime authorization audit against the production build. Every dashboard page,
 * admin page and dashboard API route found on disk is requested as: anonymous, the owner of
 * ANOTHER restaurant, and a waiter of this restaurant. No case may return restaurant data.
 */
const APP = path.resolve(__dirname, '../../src/app');
const BASE = 'http://localhost:3100';
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const rel = (p: string) => path.relative(APP, p).split(path.sep).join('/');
const urlFor = (file: string, slug: string) =>
  '/' +
  rel(file)
    .replace(/\/(page|route)\.tsx?$/, '')
    .replace('[org]', slug)
    .replace(/\[\.\.\.\w+\]|\[\w+\]/g, 'x');
const all = walk(APP);
const dashboardPages = all.filter((f) => rel(f).startsWith('dashboard/[org]/') && f.endsWith('page.tsx'));
const adminPages = all.filter((f) => rel(f).startsWith('admin') && f.endsWith('page.tsx'));
const apiRoutes = all
  .filter((f) => rel(f).startsWith('api/dashboard/') && f.endsWith('route.ts'))
  .flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/^export async function (GET|POST|PATCH|PUT|DELETE)\b/gm)].map((m) => ({ file: f, method: m[1] })));
const permissionOf = (f: string) => readFileSync(f, 'utf8').match(/requireTenantPage\(\s*\w+\s*,\s*'([a-zA-Z.]+)'/)?.[1];

let a: Seed;
let b: Seed;
test.beforeAll(() => {
  a = seed(`ra${Date.now()}`);
  b = seed(`rb${Date.now()}`);
});

test('M13-01: anonymous visitors are sent to login; anonymous API calls are refused', async ({ page }) => {
  expect(dashboardPages.length).toBeGreaterThan(35);
  for (const f of dashboardPages) {
    await page.goto(urlFor(f, a.orgSlug));
    expect(page.url(), rel(f)).toContain('/login');
  }
  for (const f of adminPages) {
    const res = await page.goto(urlFor(f, a.orgSlug));
    expect(page.url().includes('/login') || res?.status() === 404, rel(f)).toBe(true);
  }
  const anon = await pwRequest.newContext({ baseURL: BASE });
  for (const r of apiRoutes) {
    const res = await anon.fetch(urlFor(r.file, a.orgSlug), { method: r.method, headers: { Origin: BASE, 'Content-Type': 'application/json' }, data: r.method === 'GET' ? undefined : '{}', maxRedirects: 0 });
    expect([401, 403, 404], `${r.method} ${rel(r.file)} → ${res.status()}`).toContain(res.status());
  }
  await anon.dispose();
});

test('M13-01: the owner of another restaurant gets 404 on every page and API of this one, and on admin pages', async ({ page }) => {
  await login(page, b.owner, b.password);
  for (const f of dashboardPages) {
    const res = await page.goto(urlFor(f, a.orgSlug));
    expect(res?.status(), rel(f)).toBe(404);
  }
  for (const f of adminPages) {
    const res = await page.goto(urlFor(f, a.orgSlug));
    expect(res?.status(), rel(f)).toBe(404);
  }
  for (const r of apiRoutes) {
    const res = await page.request.fetch(urlFor(r.file, a.orgSlug), { method: r.method, headers: { Origin: BASE, 'Content-Type': 'application/json' }, data: r.method === 'GET' ? undefined : '{}', maxRedirects: 0 });
    expect([403, 404], `${r.method} ${rel(r.file)} → ${res.status()}`).toContain(res.status());
  }
});

test('M13-01: a waiter is kept out of every page their role does not allow', async ({ page }) => {
  await login(page, a.waiter, a.password);
  const allowed = new Set<string>(ROLE_PERMISSIONS.WAITER);
  let checked = 0;
  for (const f of dashboardPages) {
    const perm = permissionOf(f);
    if (!perm || allowed.has(perm)) continue;
    await page.goto(urlFor(f, a.orgSlug));
    expect(page.url(), `${rel(f)} (${perm})`).toMatch(/\/forbidden$/);
    checked++;
  }
  expect(checked).toBeGreaterThan(20);
});
