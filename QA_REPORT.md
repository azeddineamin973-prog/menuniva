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

## Run 2 — 2026-10-30 (session 2): closing M1–M4, M6, M7

| Check | Command | Result |
|---|---|---|
| Type check | `npx tsc --noEmit` | ✅ 0 errors |
| Unit + integration | `npm test` | ✅ 11 files, **88 tests passed**, 0 failed |
| Browser E2E (production build, test DB, Chrome) | `npm run test:e2e` | ✅ **14 tests passed**, 0 failed (56 s) |

### New automated coverage
| File | Covers (task IDs) |
|---|---|
| `tests/integration/menu-advanced.test.ts` | M4-05 location price overrides + per-location hiding, imported Glovo price does not change in-house price, cross-tenant override rejected; M4-08 product and category schedules enforced in the menu **and** server pricing, real order refused outside hours; M4-14 tax classes in basis points, approval, deletion guard, cross-tenant rejection; M3-07 plan location limit + complete new location |
| `tests/integration/uploads-and-reset.test.ts` | M3-05 magic-byte detection, SVG renamed to .png rejected, >5 MB rejected, path traversal rejected; M2-14 single-use reset link changes password and revokes all sessions, expired links and short passwords rejected |
| `tests/e2e/auth-roles-mobile.spec.ts` | M2-05 identical error for wrong password / unknown email, login, logout, disabled user blocked; M3-10 kitchen staff land on KDS, management pages → forbidden, live-orders API → 403; waiter navigation; M1-09 360 px mobile nav, no horizontal overflow, dark mode persists after reload; M4-09 sold-out from phone reaches guest menu |
| `tests/e2e/super-admin.spec.ts` | M2-12 / TEST 16: invalid and reused setup tokens refused, admin created, tenant created with invitation, owner signs up and accepts, non-admin gets 404 on /admin, suspension requires a reason and redirects owner to /suspended, platform actions in audit log, admin has no implicit tenant access (404) |
| `tests/e2e/menu-branding.spec.ts` | M6-08 required choice error, size + extra → 20,50 € server total; M4-11/12/13 manual French translation shown to guests, Spanish falls back to source text, review step recorded, disabling Arabic removes it from guest language list; M1-08/M3-04/M6-05 logo upload, SVG-as-PNG refused, branding colours/pattern on storefront, media served `image/png` + `nosniff`, title, description, canonical, Open Graph, JSON-LD Restaurant, private table page `noindex`; M6-04 PDF (`%PDF-`), print sheet, anonymous PDF download → 401 |
| `tests/e2e/live-ops.spec.ts` | M7-05 new order → chime + browser notification (recorded via stubs), unread counter, title badge, persists after reload until “Seen”, mute remembered; M7-10 offline badge while network is cut, order placed meanwhile appears after reconnect; M8-04 waiter acknowledges and closes call-waiter / bill requests; CSRF and unknown QR token rejected |

### Defects found and fixed in this run
1. **Pricing ignored availability schedules** — a lunch-only dish could still be ordered through the API at night. `quoteCart` now enforces product and category schedules (regression test added).
2. **Forms lost typed values after a server-side validation error** (React 19 resets uncontrolled forms after every action). Example: the Super Admin suspension reason. All shared forms now submit via `keepValuesOnSubmit`.
3. A server page called a helper exported from a client file (`groupSchedules`) — moved to `src/lib/schedules.ts`.

### Master-spec test status after Run 2
TEST 1, 3, 4, 5, 6, 7, 16, 17 ✅ · TEST 15 orders ✅ (feedback/customers pending M11) · TEST 18 partial (M8) · TEST 2, 8–14, 19, 20 not built yet.

### Still manual
- Hearing the chime on a real tablet speaker and real OS notifications (code path verified with stubs).
- Visual quality of the printed QR sheet on paper.

## Run 3 — 2026-10-30 (session 2): M5 Import Studio

| Check | Command | Result |
|---|---|---|
| Type check | `npx tsc --noEmit` | ✅ 0 errors |
| Unit + integration | `npm test` | ✅ 13 files, **128 tests passed**, 0 failed |
| Browser E2E | `npm run test:e2e` | ✅ **15 tests passed** (live-ops spec re-run twice: stable) |

| File | Covers |
|---|---|
| `tests/unit/import-parsers.test.ts` (34 tests) | CSV delimiter/quotes/BOM/PT decimals/5-language headers, size variants, unreadable prices flagged; real .xlsx (inline + shared strings); text heuristics (categories, descriptions, “Mesa 12”/“Menu 2024” not prices); native PDF text extraction; text-less PDF and photos → honest failure (no fake items); Glovo/Uber never “Connected”, store pages not scraped, wrong host / http rejected, merchant export accepted; SSRF private ranges (IPv4/IPv6/mapped), URL rules, private DNS resolution blocked; duplicate similarity and grouping |
| `tests/integration/import.test.ts` | **TEST 2** CSV → review → publish → customer menu (draft for item without price, nothing before publish, no double publish); **TEST 19** failed CSV + Glovo link + photo → nothing published; Glovo €16,90 + Uber Eats €17,50 → one canonical dish, both platform prices stored as references, no in-house price set; existing dish never overwritten (only a reference price is linked); cancel/rollback; tenant isolation |
| `tests/e2e/import-studio.spec.ts` | Browser: adapter statuses, broken CSV error, Glovo link refusal, CSV upload, duplicate-of-existing skipped, translation-required notice, publish visible, guest sees new dish and the original dish keeps its price |

Defect fixed: after an error the Import Studio kept the previous file when the source type changed — the file field now resets per source type.
