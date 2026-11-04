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
  'r/[org]/order/[mode]/checkout/page.tsx': 'public takeaway/delivery checkout (cart in the browser; the order API checks everything)',
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
  'api/cron/retention/route.ts': 'Vercel Cron; answers 404 without the CRON_SECRET bearer token',
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
// Dashboard route handlers that only require membership (tenantRoute(…, undefined, …)), with reason.
// No single permission is held by every role (kitchen staff: kds.*, drivers: delivery.driver only), so
// the route cannot demand one; the service computes each part only behind its own ctx.can() check,
// scoped to the member's locations (behaviour: tests/integration/nav-counts-access.test.ts).
const MEMBER_ONLY_ROUTES: Record<string, { reason: string; service: string; gates: string[] }> = {
  'api/dashboard/[org]/counts/route.ts': {
    reason: 'sidebar badges + attention summary for every role',
    service: '../../src/server/services/nav-counts.ts',
    gates: ["ctx.can('orders.view')", "ctx.can('tasks.manage')", "ctx.can('payments.record')", "ctx.can('reservations.manage')", "ctx.can('reviews.view')", 'attentionFor(ctx'],
  },
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
      } else if (f.startsWith('account/')) {
        if (!/getCurrentUser\(\)[\s\S]*redirect\('\/login/.test(src)) problems.push(`${f}: account page without a session check`);
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
          const memberOnly = MEMBER_ONLY_ROUTES[f];
          if (memberOnly) {
            // Membership is still checked (tenantRoute), read-only, and every count stays behind its gate.
            if (fn.name !== 'GET') problems.push(`${f} ${fn.name}: member-only routes may only read`);
            if (!/tenantRoute\([^,]+,[^,]+,\s*undefined\s*,/.test(fn.body)) problems.push(`${f} ${fn.name}: member-only route without tenantRoute(req, org, undefined, …)`);
            const service = readFileSync(path.resolve(__dirname, memberOnly.service), 'utf8');
            for (const g of memberOnly.gates) if (!service.includes(g)) problems.push(`${f}: ${memberOnly.service} lost its gate ${g}`);
          } else if (!m) problems.push(`${f} ${fn.name}: no tenantRoute()/requireTenantAction() with a permission`);
          else if (!perms.has(m[1])) problems.push(`${f} ${fn.name}: unknown permission ${m[1]}`);
          if (fn.name !== 'GET' && fn.body.includes('requireTenantAction(') && !fn.body.includes('assertSameOrigin(')) problems.push(`${f} ${fn.name}: write without origin check`);
        } else if (f.startsWith('api/account/')) {
          if (!fn.body.includes('getCurrentUser()')) problems.push(`${f} ${fn.name}: no session check`);
        } else if (f.startsWith('api/public/')) {
          if (fn.name !== 'GET' && !fn.body.includes('assertSameOrigin(')) problems.push(`${f} ${fn.name}: public write without assertSameOrigin()`);
        } else if (!PUBLIC_ROUTES[f]) problems.push(`${f} ${fn.name}: not classified`);
      }
    }
    for (const f of Object.keys(MEMBER_ONLY_ROUTES)) if (!files.includes(f)) problems.push(`${f}: listed as member-only but no longer exists`);
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
        } else if (f === 'account/actions.ts') {
          if (!/withUser\(/.test(b)) problems.push(`${f} ${fn.name}: no session check (withUser)`);
        } else if (f === 'onboarding/new/actions.ts') {
          if (!b.includes('getCurrentUser(')) problems.push(`${f} ${fn.name}: no session check`);
        } else if (!PUBLIC_ACTIONS[fn.name]) problems.push(`${f} ${fn.name}: not classified`);
      }
    }
    // The admin wrapper itself must check the platform role.
    expect(read('admin/actions.ts')).toMatch(/async function adminRun[\s\S]*?requirePlatformAdminAction\(\)/);
    expect(read('account/actions.ts')).toMatch(/async function withUser[\s\S]*?getCurrentUser\(\)[\s\S]*?redirect\('\/login/);
    expect(problems).toEqual([]);
  });
});
