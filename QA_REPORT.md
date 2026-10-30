# MenuNiva — QA Report

Real verification results only. Each run lists the command, environment and outcome.
Environment for all runs below: macOS 26.6.2 (arm64), Node 24.11.1, PostgreSQL 18 (embedded,
local), Next.js 16.4.3, Prisma 7.10.1, Vitest 4.1.12, Playwright 1.64.1 with installed Google Chrome.

## Run 1 — 2026-10-30 (session 1)

| Check | Command | Result |
|---|---|---|
| Type check | `npx tsc --noEmit` | ✅ 0 errors |
| Production build | `next build` (run by Playwright webServer) | ✅ succeeded |
| Database migration | `prisma migrate dev --name init` / `migrate deploy` (test DB) | ✅ applied `20261030002510_init` |
| Unit + integration tests | `npm test` | ✅ 9 files, **73 tests passed**, 0 failed |
| Browser end-to-end | `npm run test:e2e` | ✅ 1 test passed (vertical slice, 13.5 s) |
| Secrets in client bundle | grep of `.next-e2e/static` for DB password, APP_SECRET, `DATABASE_URL` | ✅ 0 matches |
| CSRF on public order API | `curl` POST without Origin / with foreign Origin | ✅ 403 / 403 |
| Validation on public order API | same-origin POST with empty body | ✅ 422 with field issues |
| Dashboard API without session | `curl /api/dashboard/casa-de-marrocos/orders/live` | ✅ 401 |
| Health check | `curl /api/health` | ✅ `{"status":"ok","database":"ok"}` |
| Casa de Marrocos tenant | `npm run setup:casa` + DB read-back | ✅ real name/address/phone, 4 service areas, 2 stations, 0 dishes, 0 tables, no hours/postal code |
| Super Admin token CLI | `create-setup-token.ts` against test DB | ✅ prints single-use link; refuses when an admin exists (unit-tested) |

### Failures found and fixed during this run
1. `parseMoneyToCents('16,999')` was accepted as 16 999 € — now rejected as ambiguous (forces human review).
2. Prisma/Zod: `z.record(enum)` required **all five** languages, so saving a category with only the
   Portuguese name failed in the browser. Fixed with `z.partialRecord`; regression test added (`menu.test.ts`).
3. CLI scripts crashed because services imported Next.js modules through the error classes — moved to `src/server/errors.ts`.
4. E2E against `next dev` timed out (on-demand compilation + server-action reloads). E2E now runs on a production build.

### Automated test inventory

| File | Covers |
|---|---|
| `tests/unit/money.test.ts` | integer-cent parsing (PT/EN formats), rounding, ambiguity rejection |
| `tests/unit/postal.test.ts` | PT `0000-000`, ES `00000` (province 01–52), zone wildcard matching |
| `tests/unit/i18n.test.ts` | 5 dictionaries have identical keys, no empty strings, Arabic RTL |
| `tests/unit/permissions.test.ts` | kitchen/delivery/manager restrictions, role-assignment limits |
| `tests/integration/tenancy.test.ts` | **TEST 1**, **TEST 15 (base)**: membership, cross-tenant location IDs, role checks, suspended tenants, location-scoped staff, Super Admin has no implicit tenant access |
| `tests/integration/platform-setup.test.ts` | one-time Super Admin bootstrap, expired tokens, concurrent token use → exactly one admin; PostgreSQL rate limiter |
| `tests/integration/menu.test.ts` | source-language-only menus, cents, refusal of visible dishes without price, unverified allergens hidden, MACHINE translations hidden until reviewed, variants/modifiers, cross-tenant category/station rejection |
| `tests/integration/ordering.test.ts` | price tampering ignored, required modifiers, **TEST 4/6** NEW→COMPLETED with real customer status, impossible/stale transitions, **TEST 5** kitchen/café routing + readiness, **TEST 7** concurrent duplicate submission → 1 order, **TEST 17** sold out, historical price snapshots, paused/rotated QR, **TEST 15 (orders)** |
| `tests/integration/staff-and-setup.test.ts` | invitations (email must match, single use), role enforcement, manager limits, last-owner protection, call-waiter/bill tasks (de-duplicated), setup progress derived from data |
| `tests/e2e/vertical-slice.spec.ts` | Browser: sign-up → register → details → stations → categories → dishes → table ordering on → 3 tables/QR → publish → guest scans QR → **TEST 3** five languages + Arabic RTL → order food + tea (server total 19,40 €) → staff accepts → kitchen sees only food, café only tea → guest sees PREPARING → both ready → complete → guest sees COMPLETED |

### Master-spec end-to-end tests status

| Test | Status |
|---|---|
| 1 Data isolation A/B | ✅ integration |
| 2 CSV import → publish → menu | ⬜ not built (M5) |
| 3 Five languages + RTL | ✅ E2E |
| 4 Table QR order appears in dashboard | ✅ integration + E2E |
| 5 Food → Kitchen, tea → Café | ✅ integration + E2E |
| 6 NEW → COMPLETED, customer sees status | ✅ integration + E2E |
| 7 Idempotency | ✅ integration (concurrent) |
| 8–12 Takeaway, delivery, zones, promotions, reservations | ⬜ not built (M9–M10) |
| 13–14 Feedback + equal Google link | ⬜ not built (M11) |
| 15 A cannot access B orders/feedback/customers | 🟨 orders ✅; feedback/customers not built yet |
| 16 Super Admin creates tenant + onboarding | 🟨 onboarding ✅ E2E (self-registration); admin UI not browser-tested |
| 17 Sold out blocks ordering | ✅ integration |
| 18 Unpaid ≠ revenue | 🟨 dashboard separates order value vs payments recorded; payment recording not built (M8) |
| 19 Import failures publish nothing | ⬜ (M5) |
| 20 Casa de Marrocos demo flow in separate env | ⬜ (M13) |

### Not verified in this run (manual checks still needed)
- Sound alerts and browser notifications (require a human click; implemented, not automatable here).
- Mobile viewport usability pass of dashboard screens.
- QR PDF download and printable sheet visual check.
- Super Admin screens in a browser; password reset links.
- Logo/branding uploads.
