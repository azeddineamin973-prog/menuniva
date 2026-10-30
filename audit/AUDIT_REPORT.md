# MenuNiva — Independent Platform Audit (2026-10-30)

Audited commit: `e90ef6f` (clean working tree at start). Workspace: `~/Desktop/saas/menuniva`.
Everything below was re-checked today against source code, the real PostgreSQL databases and a real
Chrome browser. Old TODO checkmarks, FEATURE_MATRIX labels and QA_REPORT results were not used as proof.

> The "Master Specification" document itself is not in the workspace. The audit uses the
> requirements as restated in `docs/ROADMAP.md`, `TODO.md`, `docs/FEATURE_MATRIX.md` and the 31
> areas listed in the audit request.

Evidence locations (all inside `audit/`, nothing outside the project was touched):

| What | Where |
|---|---|
| Full unfiltered logs of every run (start, end, exit code) | `audit/logs/<run>.log`, index `audit/logs/RUNS.txt` |
| Database evidence captured during browser runs | `audit/logs/evidence-phase-e.json`, `evidence-phase-f.json`, `evidence-phase-g.json` |
| Screenshots | `audit/artifacts/screenshots/*.png` (36 files) |
| Failure screenshots / traces from failed runs (kept) | `audit/artifacts/playwright/`, `audit/artifacts/e2e-run1/`, `audit/artifacts/d-analytics-iso-*` |
| Audit browser tests | `audit/acceptance/phase-e.spec.ts`, `phase-f.spec.ts`, `phase-g.spec.ts`, config `audit/playwright.audit.config.ts` |
| Probes | `audit/phaseD-seed-fetch.mjs`, `audit/phaseG-concurrency.mjs`, `audit/phaseG-session-race.mjs`, `audit/phaseF-backup.sh` |

---

## Phase A — Protection of the existing project

| Check | Result |
|---|---|
| Git | HEAD `e90ef6f`, tag `v1.0.0-rc.1` on `3a2f5a3`, working tree clean, no stashes |
| Databases (local embedded PostgreSQL 18 on 127.0.0.1:5433) | `menuniva_dev` (real: Casa de Marrocos + 2 other onboarding tenants, 2 users, 1 table, 0 orders), `menuniva_test` (automated tests, wiped by them), `menuniva_demo` (fictitious) |
| Isolation guards in code | Vitest and Playwright refuse to run unless `TEST_DATABASE_URL` contains `menuniva_test`; demo seed refuses a DB without `demo`; `env.ts` refuses `APP_ENV≠test` on a `*test*` DB |
| Safety backup before any test | `backups/menuniva_dev-2026-10-30T11-38-17-439Z.ndjson.gz` (65 rows, read-only snapshot) |
| Dev data untouched | Content fingerprint (row count + md5 per table) taken before the audit and again after all audit runs: **identical** (`audit/logs/dev-fingerprint-before.json` vs `-mid.json`) |
| User's running dev server (port 3000) | Left alone. The production build was written to the separate `.next-e2e` folder (`NEXT_DIST_DIR`), never to `.next` |
| Not done | No npm cache cleaning, no installs, no deployment, no real messages/payments/reviews |

Disk: 1.2–1.3 GB free on the Mac during the audit (100 % used). Builds fit, but this remains an operational risk.

---

## Phase C — Fresh test runs (retries disabled everywhere)

| Run | Command | Start (UTC) | End | Exit | Passed | Failed | Skipped | Retries |
|---|---|---|---|---|---|---|---|---|
| Type check (incremental, project command) | `npm run typecheck` | 11:38:42 | 11:38:45 | 0 | — | 0 errors | — | — |
| Type check from scratch | `npx tsc --noEmit --incremental false` | 11:38:49 | 11:38:59 | 0 | — | 0 errors | — | — |
| Production build | `NEXT_DIST_DIR=.next-e2e npm run build` | 11:39:03 | 11:39:29 | 0 | 80 routes (2 static, rest dynamic) | 0 | — | — |
| Unit + integration | `npx vitest run` (= `npm test`) + JSON reporter | 11:39:34 | 11:40:45 | 0 | **246** | 0 | 0 | 0 |
| Browser E2E | `npx playwright test --retries=0` (= `npm run test:e2e`) | 11:40:56 | 11:43:27 | 0 | **37** | 0 | 0 | 0 |
| Casa de Marrocos DEMO | `npx playwright test --config playwright.demo.config.ts --retries=0` (= `npm run test:demo`) | 11:43:49 | 11:44:24 | 0 | **1** | 0 | 0 | 0 |

Logs: `audit/logs/typecheck*.log`, `build.log`, `vitest.log` + `vitest-results.json`, `e2e-run1.log`, `demo-run1.log`.

Observation on the existing tests (not a failure, but it limits what they prove): several existing
browser tests take shortcuts through SQL instead of the UI — the analytics test inserts the payment
with SQL, the takeaway/delivery tests set kitchen tickets READY with SQL, the reviews test sets the
Google link with SQL, the reservations test enables reservations and hours with SQL. The audit
browser tests below do all of these through the UI.

---

## Phase D — The sporadic 404 in `analytics-subscription.spec.ts`

**Status: ROOT CAUSE IDENTIFIED (reproduced). Fix: see "Fixes".**

| Experiment | Runs | Result |
|---|---|---|
| Spec alone, 10 separate Playwright invocations (fresh build + fresh server + fresh seed each), `--retries=0` | 10 | 10/10 passed (`d-analytics-iso-1..10.log`) |
| Full suite run | 1 | 37/37 passed |
| Direct probe: real e2e seed → immediate `GET /t/<token>` on a freshly started `next start` (includes the very first request to the route) | 30 | 30/30 HTTP 200 (`d-seed-fetch-30.log`) |
| **Same probe while `npx vitest run` runs at the same time** | 40 + 40 | **HTTP 404 for a seeded table: 1 + 4 times**; seeds themselves failed 2 + 23 times (`d-seed-fetch-during-vitest*.log`) |
| Vitest while the probe ran | 2 | 1 and 12 Vitest tests failed (`d-concurrent-vitest*.log`) — the interference goes both ways |
| Probe while `next build` rewrites the served `.next-e2e` folder | 15 | 3 × HTTP **500** (not 404), then 200 (`d-seed-fetch-during-build.log`) |

Cause: `menuniva_test` is shared by the Vitest suite (which `TRUNCATE`s every table in many tests)
and the Playwright suite (which seeds a restaurant, then opens its table page). Nothing prevents both
from running at the same time. When they overlap, the just-seeded table is deleted before the
browser opens it and `/t/<token>` correctly answers 404. The QA note from the previous session also
records a second overlapping run ("another `next build` was still holding the build folder"), so the
previous session did run suites in parallel. Ruled out: stale build/cache (all pages are dynamic,
`Cache-Control: no-store`), uncommitted seed transaction (the seed exits only after commit), wrong
database (env guards), server not ready (30/30 first-request probe passed), Playwright ordering
(webServer starts before globalSetup; one worker).

A related harness defect: the E2E and DEMO configs build into the same `.next-e2e` folder, so running
them at the same time makes the running server return HTTP 500 (reproduced). This is not the 404, but
it is the "demo run failed once" note in QA_REPORT.

Product risk assessment: the 404 itself was a test-harness problem, **not** a product bug. A real
production server has no process truncating its database.

---

## Phase E — Real-browser restaurant acceptance test (DEMO database)

`audit/acceptance/phase-e.spec.ts`, final run `e-acceptance-run7.log`: **13/13 passed** (retries 0).
Earlier runs 1–5 failed because of mistakes in the new test itself (wrong enum name, missing `location`
parameter, a URL regex that also matched `/products/new`, locale-specific money text); each is
explained in the spec. Run 6 also passed but tested server-action tampering the wrong way (React
restores hidden inputs), so run 7 replaced it with real in-flight request rewriting.

| Step | Result | Evidence |
|---|---|---|
| 1 Two restaurants via `/signup` + `/onboarding/new` | ✅ two orgs, one owner each | `evidence-phase-e.json → step1` |
| 2 Owner A signs out (session cookie gone, `/orders` → login) and back in | ✅ | `e02-owner-dashboard.png` |
| 3 Address, stations Cozinha (KITCHEN) + Café (CAFE), 2 categories, Tajine 16,90 / Chá 2,50 | ✅ DB: 1690 and 250 cents, routed to the right station | `step3-db-menu`, `e03-menu-admin.png` |
| 4 Publish | ✅ `isPublished=true`, `tableOrderingEnabled=true` | |
| 5 Five languages, human translations EN/FR/ES/AR, Arabic RTL | ✅ `dir=rtl` + `lang=ar`; untranslated tea shows source text | `step5`, `e05-guest-arabic-rtl.png` |
| 6 Tables 01–02, QR | ✅ served SVG is byte-identical to a QR generated for `APP_BASE_URL/t/<token>`; PNG and PDF sheet OK; anonymous QR request 401 | `step6-qr`, `e06-tables-qr.png` |
| 7–8 Guest context without cookies orders Tajine + Chá | ✅ server total 19,40 € | `e08-guest-cart.png` |
| 9 DB check | ✅ order NEW/UNPAID 1940; items snapshot names, unit prices 1690/250, stations Cozinha/Café; tracking token stored only as SHA-256 | `step9-db` |
| 10–11 Separate staff context; order visible, also after reload | ✅ | `e11-live-board-new.png` |
| 12 Accept | ✅ 2 kitchen tickets created | |
| 13–14 Kitchen shows only Tajine, Café only Chá | ✅ | `e13-kds-kitchen.png`, `e13-kds-cafe.png` |
| 15–16 Both stations ready; guest sees PREPARING then READY | ✅ | `e16-guest-ready.png` |
| 17 Complete + cash payment 19,40 + close table | ✅ DB COMPLETED/PAID/1940 | `step17-db`, `e17-bill-paid.png` |
| 18 Table 02: call waiter + request bill | ✅ two StaffTask rows, shown on `/tasks`, closed by staff | `e18-*.png` |
| 19 Split: tea line 5,00 cash (item allocation) + 16,90 card (amount) | ✅ balance 0; DB 2 payments, 1 allocation | `step19-db-payments`, `e19-split-bill.png` |
| 20 1★ private feedback with follow-up | ✅ LOW_RATING notification row + inbox alert. **In-app only: no email/push is sent** | `e20-*.png` |
| 21 5★ | ✅ the 4 captured Google links (before/after, 1★/5★) are identical | `step20-21` |
| 22 Analytics | ✅ order value 41,30 € = collected 41,30 € = DB sums | `step22`, `e22-analytics.png` |
| 23 Restaurant B attacks A | ✅ 12 A pages, 3 B-URLs with A IDs, 10 API calls → all 404/401 and no A data in any body; **real Server Action requests rewritten in flight** to A's product ID → "Product not found."; to `org=A` → "You do not have permission"; A's price unchanged | `step23`, `e23-restaurant-b.png` |

---

## Phase F — Other business flows (DEMO database)

`audit/acceptance/phase-f.spec.ts`, final run `f-flows-final.log`: **8/8 passed**. Earlier runs failed
because of the audit tests (selector collision, rate limit on sign-ups — see BUG-05 —, a flashing
promo message — see BUG-08 —, a wrong column name).

| Flow | What was done | Result |
|---|---|---|
| Takeaway | Lead time 20 min, minimum 5,00 €, pickup point, 7-day pickup hours via UI; guest below minimum → `below_minimum` "Pedido mínimo: 5,00 €"; guest picks a **specific slot** (13:00), order stored with `pickupAt`; accept → KDS start/ready on both stations → "Pronto para levantamento" → completed. Events NEW→ACCEPTED→PREPARING→READY→COMPLETED | ✅ |
| Delivery | Zone `4700-*, 4710-*`, fee 2,50, minimum 10,00; driver invited through the real invitation link, signs up, accepts; guest with `4900-001` → outside-zone notice + disabled button; `4700-123` → fee 2,50, total 16,00 (delivery price 13,50 + fee); owner assigns driver; driver (mobile viewport) out → delivered with cash → DB DELIVERED / PAID / 1600 | ✅ (the direct-API "outside zone" call in the test was rejected earlier for a short name; the browser check stands) |
| Promotions | 10 % code → 12,60 (from 14,00); 3 € → 11,00; expired code → refused; duplicate code → "This code is already used by another promotion."; single-use code: 1st order 13,00 stored, 2nd refused; 2×1 tea → 12,00 stored with `OrderDiscount` "Audit chá 2×1: 200" | ✅ (BUG-07, BUG-08) |
| Reservations | Hours/limits via UI; 2 guest requests for 20:00; A assigned table 01 + confirmed; B on table 01 → "This table is already booked at that time"; 20:00 disabled for a 3rd party (capacity 4); A cancelled → guest page CANCELLED | ✅ |
| Menu import | One job, 3 sources: CSV (`;`, decimal comma, accents), XLSX, text PDF (made with macOS `cupsfilter`). 3 + 2 + 3 items; **nothing created before publish**; publish → 8 dishes, every price exact (650, 1490, 220, 725, 1840, 580, 490, 1560 cents); guest menu shows them | ✅ (GAP-01; XLSX caveat below) |
| Glovo / Uber Eats | Adapter cards: "Not connected — requires Glovo/Uber Eats approval". Store links refused with an honest message. Glovo merchant-export CSV accepted: dish created as DRAFT with **no in-house price** and the 11,90 € stored only as `ExternalSourcePrice(GLOVO)`. No `IntegrationConnection` rows exist | ✅ honest; the APIs are not integrated |
| Translation | Page: "Needs configuration — No provider set"; no bulk-translate button; manual EN translation stored as REVIEWED; 15 cells missing | ✅ manual only |
| Printer | Ticket print page shows only the station's items; ticket PDF `%PDF-` (1 056 bytes). No printer hardware tested; no code sends anything to a printer | browser/PDF ✅, direct printing not built |
| Subscriptions | New tenant = Starter, trialing, tables 30/30; 31st table → "Your plan allows up to 30 tables."; owner requests Growth; Super Admin (created with the real one-time CLI token + `/setup`) sees the pending change and applies it; owner sees Growth, 30/80; 31st table created; audit row `platform.plan_change_applied`. No money involved (manual billing) | ✅ |
| Backup / restore | `npm run backup` of the demo DB → `npm run restore` into new disposable DB A → backup A → restore into disposable DB B → **71 tables, 3 570 rows, identical content hash in demo, A and B**. Restore into a non-empty DB refused; damaged file refused, target left empty. Disposable DBs dropped afterwards | ✅ (`f-backup-restore.log`) |

XLSX caveat: no Excel/LibreOffice is installed; automating Apple Numbers was blocked by macOS, so the
XLSX file was produced by the repo's own OOXML writer (`audit/fixtures/make-xlsx.ts`). A file saved
by Microsoft Excel was **not** tested.

---

## Phase G — Security & reliability

`audit/acceptance/phase-g.spec.ts` (`g-security-run4.log`: 9 passed, 1 failed = BUG-01) and probes.

| Check | Result |
|---|---|
| Price tampering | Fake `unitPriceCents`, `totalCents`, `discountCents` ignored → stored 1500/1500/0. Quantity 0, −3, 51, 1.5, empty cart → 422; another restaurant's product and invented modifier → 422 `items_unavailable` ✅ |
| Duplicate submission | Same idempotency key × 6 in parallel → one order (#2, five `duplicate=true`). Triple click in UI → one order ✅ |
| **Concurrent orders** | **BUG-01**: 10 or more simultaneous submissions → every one of them fails with HTTP 500 after 5 s (`g-concurrency-probe.log`: 9 → 9 ok; 10 → 10 × 500, 0 stored; 12 → 10 × 500; 20 → 13 × 500). **BUG-03**: 2 guests ordering first on the same table at the same moment → 2 separate open table sessions (6/6 tables); 9 guests → 9 sessions (`g-session-race*.log`) |
| Rate limiting | Same device: 9th order in 10 min → 429 ✅. **BUG-05**: 9 different guests on one Wi-Fi with the same phone model → 9th refused (false positive); one attacker rotating `X-Forwarded-For` → 12/12 accepted (limit bypassed). Sign-up limit (10/IP/hour) hit by the audit itself |
| Input validation / safe errors | Malformed JSON, 5 000-char notes, SQL-like token → 422 with short codes; unknown tenant API → 401; no stack traces in bodies; HTML in kitchen notes shown as text, no script ran ✅. **BUG-04**: guest checkout without name/phone shows "Alguns preços foram alterados" (prices changed) |
| File uploads | SVG and HTML disguised as PNG → "Only PNG, JPEG or WebP"; 5.5 MB → "too large (maximum 5 MB)"; media served `image/png` + `nosniff`; `/media/..%2F..%2F.env` → 404 ✅. **BUG-06**: 7 MB upload replaces the whole page with "Something went wrong" |
| Passwords / sessions | argon2id hashes; 10-char minimum enforced; cookie `httpOnly`, `SameSite=Lax`, 30 days, `Secure` only when `APP_BASE_URL` is https (false on localhost); DB stores only the token hash; old cookie after logout → 401 ✅ |
| Private data | Tracking page and public order API contain no phone or name; altered token → 404 ✅ |
| Network interruption | (a) request never arrives (3 automatic attempts fail) → "Ligação perdida…", 0 orders; retry later → exactly 1. (b) server commits, answer lost → automatic retry with the same key → guest reaches tracking, exactly 1. (c) committed, all answers lost → guest sees "Ligação perdida. A restabelecer…" although the order **is** stored; after reload + tap → same order, exactly 1 ✅ no loss, no duplicate (BUG-10: message is misleading) |
| Backup integrity | ✅ see Phase F |
| Tenant isolation | ✅ see Phase E step 23 + existing `route-audit.spec.ts` (re-run today) |

---

## Bugs and gaps found (documented before any fix)

| ID | Severity | Area | Finding | Evidence | Cause (code) |
|---|---|---|---|---|---|
| BUG-01 | **Critical** | Ordering (table, takeaway, delivery) | When 10+ orders are submitted at the same moment — across **all** restaurants on one server process — all of them fail (HTTP 500 after 5 s, nothing stored). Guests see "connection lost" after 3 retries | `g-concurrency-probe.log`, `g-security-run4.log` | Inside the order transaction `computeDiscounts()` calls `hasModule()` → `orgModuleState()` → `getPlatformConfig()` on the global Prisma client. Each transaction holds 1 of the 10 pool connections and waits for a 2nd one → pool starvation until the 5 s transaction timeout |
| BUG-02 | High (test harness) | Tests | Sporadic 404 = Vitest and Playwright share `menuniva_test` with no mutual exclusion | Phase D | No lock between suites |
| BUG-03 | High | Table sessions / bills | Concurrent first orders on one table open several "OPEN" table sessions → the table's bill is split into separate bills | `g-session-race*.log` | `submitTableOrder` does find-then-create on `TableSession` with no unique constraint and no lock |
| BUG-04 | Medium | Guest checkout | Missing/invalid name or phone (takeaway/delivery) is reported as "Some prices changed. Review your order." | `evidence-phase-g.json → G5`, `g5-pickup-missing-contact.png` | `menu-app.tsx` treats every 422 with an `issues` array as price issues; Zod validation errors also carry `issues` |
| BUG-05 | Medium | Rate limiting | (a) Guests behind one Wi-Fi with the same phone/browser version share one "device" bucket: 8 orders / 10 min per restaurant location. (b) `X-Forwarded-For` is trusted from any client, so per-IP limits (orders, sign-up, login-per-IP, feedback, quote) can be bypassed | `G4` | `clientKeyFromRequest()` and `clientIp()` read the first `X-Forwarded-For` hop without a trusted-proxy setting |
| BUG-06 | Medium | Uploads | A file above 6 MB crashes the page to the generic error screen instead of "file too large" | `g6-7mb-upload.png` | Next.js `serverActions.bodySizeLimit: '6mb'` throws before the action runs; no client-side size check |
| BUG-07 | Low (latent) | Promotions | Start/end dates are interpreted in the **server's** time zone, not the restaurant's. On a UTC server a Lisbon promotion ends 1 h late in summer (Madrid: 2 h) | code + `evidence-phase-f.json → promotions` | `new Date(String(v))` in `promotionSchema`; `dt()` uses server offset |
| BUG-08 | Low | Promotions (guest) | Tapping "Apply" briefly shows "Este código não é válido" even for a valid code until the new quote arrives (seen for 5/5 codes) | `invalidMessageFlashedBeforeQuote` | Error is computed from the previous quote |
| BUG-09 | Low | Guest checkout | Name and phone typed in the cart are lost when the cart is closed and reopened | `takeaway → contactKeptAfterReopen: ""` | Contact state lives inside the cart sheet component |
| BUG-10 | Low | Ordering | After a lost answer the guest reads "Ligação perdida. A restabelecer…" (reconnecting) although nothing is retrying and the order may already exist | `G9 c_*` | message text |
| BUG-11 | Low (code review) | Bills | Reducing items keeps the absolute discount (`min(discount, subtotal)`), so a percentage promotion over-discounts after a reduction | `bills.ts changeOrderItem` | not executed in browser |
| BUG-12 | Low (harness) | Tests | E2E and DEMO suites build into the same `.next-e2e` folder → parallel runs give HTTP 500 | `d-seed-fetch-during-build.log` | shared `NEXT_DIST_DIR` |
| GAP-01 | Medium | Import → kitchen | Imported dishes in new categories have **no station** (7 of 8 in the test) → they reach no Kitchen/Café display and no warning is shown | `evidence-phase-f.json → import.prices` | publish creates categories without `defaultStationId` |
| GAP-02 | Medium | Printing | Direct thermal printing is not implemented: `toEscPos()` is never called, no printer settings exist. FEATURE_MATRIX calls it "NEEDS CONFIGURATION" | code search | — |
| GAP-03 | Info | Reviews | "Manager notification" is an in-app notification + badge only | Phase E step 20 | no email/SMS provider |
| GAP-04 | Info | Takeaway | If no pickup/opening hours are entered, "as soon as possible" is always allowed (24/7) | `fulfilment.ts pickupOptions` | design choice |
| GAP-05 | Info | Plans | Table-limit check is outside a transaction (two parallel bulk creations can exceed it) | `tables.ts` | code review |

---

## Feature-by-feature status (31 areas)

Classification key: VERIFIED_WORKING · IMPLEMENTED_NOT_VERIFIED · PARTIALLY_WORKING · BUG_FOUND · NEEDS_CONFIGURATION · BLOCKED_EXTERNAL_APPROVAL · NOT_IMPLEMENTED.
"Browser (audit)" = verified today in `audit/acceptance/*`; "E2E (re-run)" = existing spec re-run today with 0 retries; "Integration" = Vitest against real PostgreSQL today.

| # | Feature | Task IDs | Implementation | Route(s) | API / action | Main tables | Test → today's result | Missing dependencies | Status (before fixes) |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Multi-tenant architecture | M2-01, M2-09, M2-15 | `server/tenant.ts`, `route-tenant.ts`, `action.ts`, every service filters `organizationId` | `/dashboard/[org]/*` | `requireTenantPage/Action`, `tenantRoute` | `RestaurantOrganization`, `RestaurantMembership` | Phase E step 23 ✅; `tenancy.test.ts` 8/8 ✅; `route-audit.spec.ts` 3/3 ✅ | — | VERIFIED_WORKING |
| 2 | Authentication & staff roles | M2-03..08, M3-08..10 | `server/auth/*`, `lib/permissions.ts`, `staff/page.tsx`, `invite/[token]` | `/login`, `/signup`, `/invite/[token]`, `/dashboard/[org]/staff` | `loginAction`, `inviteStaffAction` | `User`, `Session`, `Invitation` | Phase E step 2, Phase F driver invite, G7 ✅; `auth-roles-mobile.spec.ts` 4/4 ✅; `login.test.ts` ✅ | SMTP (links shown on screen instead) | VERIFIED_WORKING; IP limits weakened by BUG-05 |
| 3 | Restaurant onboarding | M3-01..07 | `onboarding/new`, `setup/*`, `services/organizations.ts` | `/onboarding/new`, `/dashboard/[org]/setup/*` | `registerRestaurantAction`, publish action | `RestaurantLocation`, `Subscription` | Phase E steps 1–4 ✅ (registration, address, publish); wizard steps: `vertical-slice.spec.ts`, `staff-and-setup.test.ts` ✅ | — | VERIFIED_WORKING |
| 4 | Five languages & Arabic RTL | M1-10, M4-13, M6-07 | `i18n/*`, `storefront/shell.tsx` | `/t/[token]?lang=` | — | `ProductTranslation` | Phase E step 5 ✅; `i18n.test.ts` 12/12 ✅ | — | VERIFIED_WORKING (owner management screens are English-only, staff operational screens localized) |
| 5 | Menu editing & prices | M4-01..09 | `services/menu.ts`, `menu/*` pages | `/dashboard/[org]/menu/*` | `saveProductAction`, `setPriceAction` | `MenuProduct`, `ChannelPrice` | Phase E step 3, F takeaway/delivery prices ✅; `menu*.test.ts` ✅ | — | VERIFIED_WORKING |
| 6 | CSV / Excel / PDF import | M5-01..06, M5-11..14 | `server/import/*`, `import/[jobId]` | `/dashboard/[org]/import/*` | `addSourceAction`, `publishImportAction` | `ImportJob`, `ImportedProduct` | Phase F import ✅; `import*.test.ts` ✅ | OCR for scanned PDFs | VERIFIED_WORKING with GAP-01; Excel-produced XLSX not tested |
| 7 | Glovo / Uber Eats import | M5-08, M5-09 | `PlatformAdapter` in `import/adapters.ts` | same | same | `ExternalSourcePrice` | Phase F external ✅ | Partner API approval + credentials | Merchant export: VERIFIED_WORKING · API: BLOCKED_EXTERNAL_APPROVAL (no API code exists) |
| 8 | Image OCR | M5-07 | `ImageMenuImporter` (always refuses honestly) | import page | — | — | Phase F adapter card ✅ | An OCR engine | NEEDS_CONFIGURATION (engine NOT_IMPLEMENTED) |
| 9 | Automatic translation | M4-10..12 | `server/translation/index.ts` (DeepL / LibreTranslate clients) | `/dashboard/[org]/menu/translations` | `bulkTranslateAction` | `ProductTranslation` | Phase F: "No provider set", manual REVIEWED ✅; provider clients never called against a real service | DeepL key or LibreTranslate server | Manual: VERIFIED_WORKING · Automatic: NEEDS_CONFIGURATION (unverified code) |
| 10 | QR tables & printable codes | M6-01..04 | `services/tables.ts`, `api/dashboard/[org]/qr/*` | `/dashboard/[org]/tables`, `/tables/print` | QR GET routes | `RestaurantTable`, `TableQRToken` | Phase E step 6 ✅ (QR content proven) | — | VERIFIED_WORKING |
| 11 | Direct customer ordering | M6-06..11, M7-01..03 | `services/orders.ts`, `pricing.ts`, `menu-app.tsx` | `/t/[token]`, `/o/[token]` | `POST /api/public/orders/table`, `/quote` | `Order`, `OrderItem`, `OrderStatusEvent` | Phase E 7–9, G1/G2/G9 ✅; **G3 ✘** | — | BUG_FOUND (BUG-01, BUG-03) |
| 12 | Live order dashboard | M7-04, M7-05, M7-10 | `orders/live-board.tsx`, `use-polling.tsx` | `/dashboard/[org]/orders` | `GET …/orders/live`, `POST …/orders/[id]/status` | `Order`, `Notification` | Phase E 10–12 ✅; `live-ops.spec.ts` 4/4 ✅ | — | VERIFIED_WORKING (polling, not push) |
| 13 | Kitchen & Café routing | M7-06..09 | `orders.ts` (tickets, readiness), `kitchen/*` | `/dashboard/[org]/kitchen/[stationId]` | `GET/POST …/kds/*` | `KitchenStation`, `KitchenTicket` | Phase E 13–16 ✅ | — | VERIFIED_WORKING (GAP-01 for imported dishes) |
| 14 | Table sessions & bill splitting | M8-01..08 | `services/bills.ts`, `bills/*` | `/dashboard/[org]/bills/[sessionId]` | `recordPaymentAction`, `closeSessionAction` | `TableSession`, `PaymentRecord`, `PaymentAllocation` | Phase E 17–19 ✅; `bills.test.ts` 9/9 ✅; **race ✘** | — | BUG_FOUND (BUG-03; BUG-11) |
| 15 | Waiter & bill requests | M8-03, M8-04 | `services/staff-tasks.ts`, `tasks/page.tsx` | `/dashboard/[org]/tasks` | `POST /api/public/table-requests`, `…/tasks/[id]` | `StaffTask` | Phase E 18 ✅ | — | VERIFIED_WORKING |
| 16 | Kitchen ticket printing | M8-10, M8-11 | `server/printing`, `kitchen/tickets/[id]/print`, ticket PDF route | print page | `GET …/kds/tickets/[id]/pdf` | `KitchenTicket` | Phase F printer ✅ | Thermal printer + network printing code | Browser/PDF: VERIFIED_WORKING · Direct thermal: NOT_IMPLEMENTED (hardware never tested) |
| 17 | Takeaway | M9-01..03 | `services/fulfilment.ts`, `takeaway/page.tsx` | `/r/[org]/order/pickup`, `/dashboard/[org]/takeaway` | `POST /api/public/orders/pickup` | `TakeawaySettings`, `Order.pickupAt` | Phase F ✅ | — | VERIFIED_WORKING with BUG-04, BUG-09 (UX); BUG-01 applies |
| 18 | Delivery zones & fees | M9-04..08, M9-11 | `fulfilment.ts`, `delivery/*`, `driver/page.tsx` | `/r/[org]/order/delivery`, `/dashboard/[org]/delivery`, `/driver` | `POST /api/public/delivery/quote`, `/orders/delivery` | `DeliveryZone`, `DeliveryOrderDetails` | Phase F ✅ | — (no GPS/courier by design) | VERIFIED_WORKING; BUG-01 applies |
| 19 | WhatsApp links | M9-09, M9-10 | `buildWhatsAppText` in `menu-app.tsx` | `/r/[org]/order/whatsapp` | — | none (nothing stored) | `takeaway-delivery.spec.ts` (re-run) ✅ | WhatsApp Business API (not used) | VERIFIED_WORKING (prefilled `wa.me` link only; nothing is sent by MenuNiva) |
| 20 | Promotions & 2×1 | M10-01..04, AUD-09 | `lib/promotions.ts`, `services/promotions.ts` | `/dashboard/[org]/promotions` | `savePromotionAction`, quote/order APIs | `Promotion`, `Coupon`, `OrderDiscount` | Phase F ✅; `promotions*.test.ts` ✅ | Verified customer identity for AUD-09 | VERIFIED_WORKING with BUG-07, BUG-08 · AUD-09: NOT_IMPLEMENTED |
| 21 | Reservations | M10-05..09 | `services/reservations.ts`, `reserve/*`, `reservation/[token]` | `/r/[org]/reserve`, `/dashboard/[org]/reservations` | `POST /api/public/reservations` | `Reservation`, `ReservationTableAssignment` | Phase F ✅; `reservations.test.ts` 8/8 ✅ | SMS/email confirmations | VERIFIED_WORKING (guest sees status on a private page; no messages sent) |
| 22 | Smart Reviews & Google link | M11-01..05 | `services/feedback.ts`, `r/[org]/feedback`, `reviews/page.tsx` | `/r/[org]/feedback`, `/dashboard/[org]/reviews` | `POST /api/public/feedback` | `CustomerFeedback`, `Notification` | Phase E 20–21 ✅ | Email/SMS for real alerts | VERIFIED_WORKING (no review gating); alerts in-app only |
| 23 | Loyalty & rewards | M11-06..08, AUD-07 | `services/loyalty.ts`, `o/[token]/loyalty-card.tsx` | `/dashboard/[org]/loyalty` | `POST /api/public/loyalty` | `LoyaltyAccount`, `LoyaltyTransaction` | `reviews-loyalty-upsell.spec.ts` (re-run) ✅; `loyalty.test.ts` 11/11 ✅ | — | VERIFIED_WORKING (E2E + integration; not re-exercised in audit browser tests) |
| 24 | Upsell | M11-09, M11-10 | `lib/upsell.ts`, `services/upsell.ts` | `/dashboard/[org]/menu/upsell` | `POST /api/public/upsell` | `UpsellRule`, `UpsellEvent` | E2E (re-run) ✅; `upsell*.test.ts` ✅ | — | VERIFIED_WORKING |
| 25 | Analytics | M12-01..04 | `services/analytics.ts`, `analytics/page.tsx` | `/dashboard/[org]/analytics` | CSV export route | `Order`, `PaymentRecord` | Phase E 22 ✅ (UI = DB); `analytics.test.ts` ✅ | — | VERIFIED_WORKING |
| 26 | Subscription management | M12-05..07, AUD-05 | `services/plans.ts`, `limits.ts`, `subscription/page.tsx`, `billing/index.ts` | `/dashboard/[org]/subscription` | `requestPlanChange`, admin apply | `Subscription`, `SubscriptionPlan`, `BillingRecord` | Phase F ✅ | Billing processor | Manual: VERIFIED_WORKING · Automatic billing: NEEDS_CONFIGURATION (`/api/billing/webhook` answers 501) |
| 27 | Super Admin | M2-11, M2-12, M12-08 | `app/admin/*`, `services/admin.ts`, `platform-setup.ts` | `/setup`, `/admin/*` | admin actions | `PlatformSetupToken`, `AuditLog` | Phase F (real CLI token bootstrap + plan approval) ✅; `super-admin.spec.ts` ✅ | — | VERIFIED_WORKING |
| 28 | GDPR & security controls | M13-01, M13-02, AUD-06 | `services/privacy.ts`, `settings/privacy`, `services/account.ts`, `http.ts`, `rate-limit.ts` | `/dashboard/[org]/settings/privacy`, `/account` | privacy export/erase, account export | `AuditLog`, guest tables | G5–G8 ✅; `privacy.test.ts` 5/5 ✅; `spec-gaps.spec.ts` ✅ | Trusted-proxy configuration | PARTIALLY_WORKING (BUG-05, BUG-06) |
| 29 | Backups & recovery | M13-05, M13-07 | `scripts/backup.mjs`, `restore.mjs`, `lib/backup-core.mjs`, `migrate-safe.mjs` | CLI | `npm run backup/restore` | all | Phase F backup ✅; `backup-restore.test.ts` ✅ | Scheduler, off-site encrypted storage, managed DB PITR | VERIFIED_WORKING (manual command); scheduling NOT_IMPLEMENTED |
| 30 | Production deployment readiness | M13-06, M13-11 | `env.ts`, `docs/DEPLOYMENT.md`, `/api/health` | — | — | — | Not deployed; BUG-01 critical; BUG-05; no SMTP, no monitoring endpoint verified, no scheduled backups | Hosting, domain, managed EU PostgreSQL, TLS, SMTP | **NOT READY** |
| 31a | AUD-01 storefront opening hours | AUD-01 | `storefront/opening-hours.tsx` | `/r/[org]` | — | `RestaurantLocation.openingHours` | `spec-gaps.spec.ts` ✅ | — | VERIFIED_WORKING (E2E) |
| 31b | AUD-02 order priority | AUD-02 | `setOrderPriority` | live board, KDS | status route `action=priority` | `Order.isPriority` | `spec-gaps.spec.ts` + `.test.ts` ✅ | — | VERIFIED_WORKING (E2E) |
| 31c | AUD-03 pickup point | AUD-03 | `TakeawaySettings.pickupPoint` | checkout, tracking | — | `TakeawaySettings` | Phase F ✅ | — | VERIFIED_WORKING |
| 31d | AUD-04 support requests | AUD-04 | `services/support.ts` | `/dashboard/[org]/support`, `/admin/support` | support actions | `SupportTicket` | `spec-gaps.spec.ts` ✅ | — | VERIFIED_WORKING (E2E) |
| 31e | AUD-05 plan change requests | AUD-05 | `requestPlanChange/decidePlanChange` | subscription, admin tenant | — | `Subscription` | Phase F ✅ | — | VERIFIED_WORKING |
| 31f | AUD-06 account self-service | AUD-06 | `services/account.ts`, `/account` | `/account` | profile/password/export/delete | `User`, `Session` | Phase E (language change), `spec-gaps.spec.ts` ✅ | — | VERIFIED_WORKING |
| 31g | AUD-07 loyalty birthdays | AUD-07 | `loyaltyMembers(…, birthdayMonth)` | `/dashboard/[org]/loyalty` | — | `LoyaltyAccount` | `spec-gaps.test.ts` ✅ (integration only) | — | VERIFIED_WORKING (integration only) |
| 31h | AUD-08 Casa de Marrocos demo | AUD-08 | `scripts/seed-demo.ts`, `tests/e2e-demo` | demo env | — | demo DB | `demo-flow.spec.ts` 1/1 ✅ | — | VERIFIED_WORKING |
| 31i | AUD-09 promotions for identified customers | AUD-09 | — | — | — | — | — | Verified customer identity | NOT_IMPLEMENTED |

---

## Fixes applied after documentation (uncommitted, on top of `e90ef6f`)

| Bug | Fix | Files |
|---|---|---|
| BUG-01 pool starvation | The promotions module check inside the order transaction now uses the transaction client (`hasModule(…, tx)`), and `getPlatformConfig(tx)` accepts it too. No query inside an order transaction asks the pool for a second connection any more. A scan of every `$transaction(async (tx) => …)` body in `src/server/services` and `src/server/import` found no other global-client call | `services/promotions.ts`, `modules.ts`, `services/platform-config.ts` |
| BUG-02 shared test DB (the 404) | Each suite takes a PostgreSQL advisory lock on its database for the whole run (`tests/support/db-lock.ts`): Vitest and Playwright on `menuniva_test`, the demo suite on `menuniva_demo`. A second suite now stops at once with "menuniva_test is already in use by another test run (…)" | `tests/support/db-lock.ts`, the three `global-setup.ts` files |
| BUG-03 split table bills | A row lock on the table (`SELECT … FOR UPDATE`) before looking up/creating the OPEN session, used by guest ordering, staff "open table" (now one transaction) and table transfer. No schema change; a partial unique index would be a stronger guarantee but cannot be added while duplicate OPEN sessions exist in a database | `services/orders.ts` (`lockTable`), `services/bills.ts` |
| BUG-04 misleading checkout message | Only `items_unavailable` answers are shown as "prices changed"; validation errors now show "Este campo é obrigatório." | `components/storefront/menu-app.tsx` |
| BUG-12 shared build folder | The demo suite builds into its own `.next-demo` (≈140 MB; git-ignored). Next.js added the matching `include` lines to `tsconfig.json` itself | `playwright.demo.config.ts`, `.gitignore`, `tsconfig.json` |

Not fixed (left for an owner decision; all documented above): BUG-05 (needs a trusted-proxy setting that matches the future hosting), BUG-06, BUG-07, BUG-08, BUG-09, BUG-10, BUG-11, GAP-01…05. No regression tests were added to the project's own suites; the fixes are covered by the audit tests and probes in `audit/`.

### Verification after the fixes

| Run | Start–end (UTC) | Exit | Result |
|---|---|---|---|
| `npx tsc --noEmit --incremental false` | 12:53:01–12:53:14 | 0 | 0 errors (`typecheck-final.log`) |
| `npx vitest run` | 12:41:47–12:42:59 | 0 | 246/246 (`vitest-after-fix.log`) |
| Lock check: 2nd Vitest and a Playwright run started while Vitest runs | 12:43:13–12:43:46 | 1 / 1 (expected) | both refused with the lock message; the first run **246/246** (`lock-*.log`). Before the fix the same overlap broke 12 Vitest tests and gave HTTP 404s |
| `npx playwright test --retries=0` (includes `next build`) | 12:44:44–12:46:57 | 0 | 37/37 (`e2e-after-fix.log`) |
| Demo suite | 12:47:04–12:47:35 | 1 | **failed**: the audit's own restaurants were in the demo DB (the test expects only the 2 demo tenants). The audit's fictitious data was removed (backup first: `audit/backups/menuniva_demo-2026-10-30T12-48-12-098Z…`, script `audit/cleanup-demo-audit-data.mjs`) |
| Demo suite | 12:48:19–12:48:45 | 0 | 1/1 (`demo-after-fix-2.log`) |
| Audit browser tests E + F + G | 12:48:54–12:51:03 | 0 | **31/31** incl. G3 (12 simultaneous guests on one table → 12 orders, one open session, numbers 37–48) and the checkout message (`efg-after-fix.log`) |
| Concurrency probe, 2→40 simultaneous orders over 9 tables | 12:51:23–12:51:34 | 0 | every order stored at 10, 12, 20 and 40 at once (40 in 258 ms). Before: 10 → 0 stored |
| Session race, 9 and 2 simultaneous first orders per table | 12:51:34–12:51:35 | 0 | 1 open session per table on 9/9 tables (before: 9 and 2 sessions) |
| 15 simultaneous takeaway orders | 12:51:49 | 0 | 15/15 stored |
| Demo suite (final, after removing audit data again) | 12:52:19–12:52:49 | 0 | 1/1 (`demo-final.log`) |
| Dev database fingerprint | 12:52 | — | identical to the start of the audit |

### Status changes after the fixes

| # | Feature | Before | After |
|---|---|---|---|
| 11 | Direct customer ordering | BUG_FOUND | VERIFIED_WORKING (rate-limit weakness BUG-05 remains) |
| 14 | Table sessions & bill splitting | BUG_FOUND | VERIFIED_WORKING (BUG-11 open, low) |
| 17/18 | Takeaway / delivery | VERIFIED_WORKING, BUG-01 applied | VERIFIED_WORKING (BUG-09 open, low) |
| — | Test harness reliability (the 404) | OPEN | Root cause fixed and verified |

All other statuses in the table above are unchanged.

### Further observations

- The Playwright JSON reporter prints the `webServer.env` block, which contains `DATABASE_URL` and `APP_SECRET`. One audit log (`e2e-run1.log`) received them; both values were redacted in place and every audit file was re-scanned. Avoid `--reporter=json` with the current config, or stop passing secrets through `webServer.env`.
- Self-registration works in the DEMO environment and creates tenants with `isDemo = false`, which is what broke the demo test. A public demo should either close sign-ups or mark new tenants as demo.

## Production readiness — honest summary

Not ready for production today. What is solid: tenant isolation (attacked through pages, APIs and rewritten Server Action requests), server-side pricing, idempotent ordering without loss or duplication under network failure, kitchen/café routing, bills and split payments, takeaway, delivery, promotions, reservations, honest external-integration labels, and backups that restore byte-for-byte.

Still needed before real guests:
1. Deploy the BUG-01 / BUG-03 fixes and add regression tests for them to the project suites.
2. Decide hosting and configure trusted-proxy handling of `X-Forwarded-For` (BUG-05). The current key (IP + browser) will also block busy restaurants whose guests share Wi-Fi.
3. Fix GAP-01 (imported dishes have no station) before restaurants rely on import.
4. Hosting, domain, TLS, managed EU PostgreSQL with point-in-time recovery, scheduled encrypted off-site backups, SMTP, and a verified error-monitoring endpoint.
5. External services that do not exist yet: online payments, certified invoicing (AT / Verifactu), Glovo/Uber partner APIs, OCR, machine translation, thermal printers. All are correctly labelled as not connected in the app.
6. Free disk space on the development Mac (1.2–2.6 GB free during the audit).
