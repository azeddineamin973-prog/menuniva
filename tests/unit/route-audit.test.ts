import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PERMISSIONS } from '@/lib/permissions';

/**
 * M13-01 automated authorization audit. Every page, route handler and server action in
 * src/app is classified; anything new that is not protected (or explicitly listed as public
 * with a reason) fails this test.
 */
const APP = path.resolve(__dirname, '../../src/app');
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const files = walk(APP).map((p) => path.relative(APP, p).split(path.sep).join('/'));
const read = (rel: string) => readFileSync(path.join(APP, rel), 'utf8');
/** Splits a module into its exported functions (name → body). */
function exportedFunctions(src: string) {
  const re = /^export (?:async )?function (\w+)\s*\(/gm;
  const hits = [...src.matchAll(re)];
  return hits.map((m, i) => ({ name: m[1], body: src.slice(m.index!, hits[i + 1]?.index ?? src.length) }));
}
const perms = new Set<string>(PERMISSIONS);

// Public by design — each entry states why it needs no session.
const PUBLIC_PAGES: Record<string, string> = {
  'page.tsx': 'marketing home page',
  '(auth)/login/page.tsx': 'sign in',
  '(auth)/signup/page.tsx': 'sign up',
  '(auth)/forgot-password/page.tsx': 'request reset link',
  '(auth)/reset-password/[token]/page.tsx': 'single-use token in URL',
  'setup/page.tsx': 'one-time Super Admin setup token',
  'invite/[token]/page.tsx': 'single-use invitation token',
  'suspended/page.tsx': 'static notice',
  'dashboard/page.tsx': 'redirects to the user’s restaurant or login',
  'onboarding/new/page.tsx': 'redirects to login without a session',
  'r/[org]/[[...location]]/page.tsx': 'public menu of a published restaurant',
  'r/[org]/order/[mode]/page.tsx': 'public takeaway/delivery ordering',
  'r/[org]/reserve/page.tsx': 'public reservation request',
  'r/[org]/feedback/page.tsx': 'public private-feedback form',
  't/[token]/page.tsx': 'table QR token',
  'o/[token]/page.tsx': 'unguessable order tracking token',
  'reservation/[token]/page.tsx': 'unguessable reservation token',
};
const PUBLIC_ROUTES: Record<string, string> = {
  'api/health/route.ts': 'health check, no data',
  'api/billing/webhook/route.ts': 'processor webhook; refused until signature verification exists',
  'media/[...key]/route.ts': 'public restaurant images with random keys',
};
const PUBLIC_ACTIONS: Record<string, string> = {
  signupAction: 'creates an account',
  loginAction: 'signs in',
  logoutAction: 'ends the current session',
  requestPasswordResetAction: 'generic response, rate limited',
  resetPasswordAction: 'single-use token',
  bootstrapAdminAction: 'one-time Super Admin setup token, consumed atomically',
};
// Tenant pages that only require membership (no specific permission), with reason.
const MEMBER_ONLY_PAGES: Record<string, string> = {
  'dashboard/[org]/page.tsx': 'overview checks overview.view itself and redirects staff to their workspace',
  'dashboard/[org]/forbidden/page.tsx': 'static access notice',
  'dashboard/[org]/unavailable/page.tsx': 'static “not in plan” notice',
};

describe('M13-01 authorization audit (static)', () => {
  it('every page is protected or explicitly public', () => {
    const problems: string[] = [];
    for (const f of files.filter((f) => f.endsWith('/page.tsx') || f === 'page.tsx')) {
      const src = read(f);
      if (f.startsWith('dashboard/[org]/')) {
        const m = src.match(/requireTenantPage\(\s*\w+\s*(?:,\s*'([a-z.A-Z]+)')?\s*\)/);
        if (!m) problems.push(`${f}: no requireTenantPage()`);
        else if (!m[1] && !MEMBER_ONLY_PAGES[f]) problems.push(`${f}: requireTenantPage() without a permission`);
        else if (m[1] && !perms.has(m[1])) problems.push(`${f}: unknown permission ${m[1]}`);
      } else if (f.startsWith('admin/')) {
        if (!src.includes('requirePlatformAdminPage()')) problems.push(`${f}: no requirePlatformAdminPage()`);
      } else if (!PUBLIC_PAGES[f]) problems.push(`${f}: not classified (add a guard or list it as public with a reason)`);
    }
    expect(problems).toEqual([]);
  });

  it('every API route handler authenticates, or is public with origin checks on writes', () => {
    const problems: string[] = [];
    for (const f of files.filter((f) => f.endsWith('/route.ts'))) {
      const fns = exportedFunctions(read(f)).filter((x) => /^(GET|POST|PUT|PATCH|DELETE)$/.test(x.name));
      if (fns.length === 0) problems.push(`${f}: no handlers found`);
      for (const fn of fns) {
        if (f.startsWith('api/dashboard/')) {
          const m = fn.body.match(/(?:tenantRoute\([^,]+,[^,]+,|requireTenantAction\([^,]+,)\s*'([a-zA-Z.]+)'/);
          if (!m) problems.push(`${f} ${fn.name}: no tenantRoute()/requireTenantAction() with a permission`);
          else if (!perms.has(m[1])) problems.push(`${f} ${fn.name}: unknown permission ${m[1]}`);
          if (fn.name !== 'GET' && fn.body.includes('requireTenantAction(') && !fn.body.includes('assertSameOrigin(')) problems.push(`${f} ${fn.name}: write without origin check`);
        } else if (f.startsWith('api/public/')) {
          if (fn.name !== 'GET' && !fn.body.includes('assertSameOrigin(')) problems.push(`${f} ${fn.name}: public write without assertSameOrigin()`);
        } else if (!PUBLIC_ROUTES[f]) problems.push(`${f} ${fn.name}: not classified`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('every server action checks the session and permission (or is a listed public auth action)', () => {
    const problems: string[] = [];
    const actionFiles = files.filter((f) => /\.(ts|tsx)$/.test(f) && /^['"]use server['"]/m.test(read(f)));
    expect(actionFiles.length).toBeGreaterThan(10);
    for (const f of actionFiles) {
      const src = read(f);
      for (const fn of exportedFunctions(src)) {
        const b = fn.body;
        if (f.startsWith('dashboard/[org]/')) {
          const calls = [...b.matchAll(/runTenantAction\(\s*[^,]+,\s*('([a-zA-Z.]+)'|[^,]+),/g)];
          const direct = b.match(/requireTenantAction\([^,]+,\s*'([a-zA-Z.]+)'/);
          if (!calls.length && !direct) problems.push(`${f} ${fn.name}: no runTenantAction()/requireTenantAction()`);
          for (const c of calls) if (!c[2] || !perms.has(c[2])) problems.push(`${f} ${fn.name}: permission must be a known literal, got ${c[1]}`);
          if (direct && !perms.has(direct[1])) problems.push(`${f} ${fn.name}: unknown permission ${direct[1]}`);
        } else if (f.startsWith('admin/')) {
          if (!/adminRun\(|requirePlatformAdminAction\(/.test(b)) problems.push(`${f} ${fn.name}: no Super Admin check`);
        } else if (f === 'onboarding/new/actions.ts') {
          if (!b.includes('getCurrentUser(')) problems.push(`${f} ${fn.name}: no session check`);
        } else if (!PUBLIC_ACTIONS[fn.name]) problems.push(`${f} ${fn.name}: not classified`);
      }
    }
    // The admin wrapper itself must check the platform role.
    expect(read('admin/actions.ts')).toMatch(/async function adminRun[\s\S]*?requirePlatformAdminAction\(\)/);
    expect(problems).toEqual([]);
  });
});
