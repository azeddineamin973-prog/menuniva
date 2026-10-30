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

## Run 4 — 2026-10-30 (session 3): M8 Table sessions, bills, payments & printing

| Check | Command | Result |
|---|---|---|
| Type check | `npx tsc --noEmit` | ✅ 0 errors |
| Migration | `20261030015227_table_sessions_payments` (dev + test) | ✅ applied |
| Unit + integration | `npm test` | ✅ 14 files, **137 tests passed** |
| Browser E2E | `npm run test:e2e` | ✅ **17 tests passed** |

| File | Covers |
|---|---|
| `tests/integration/bills.test.ts` | M8-01/02 several orders → one session bill; M8-07/08 + TEST 18 (payments): item payment marks only that item paid, amount payment stays unallocated, overpayment refused, PAID/PARTIALLY_PAID derived from records, void re-opens balance; **3 concurrent payments → only one accepted** (row locks); M8-05 reduce/void with reason, totals recalculated, café ticket cancelled when its only item is removed, paid amounts cannot be removed, audit before/after; M8-06 transfer to free table, busy table refused, audited; closing blocked by active orders and by unexplained unpaid balance, served orders completed, next guests get a new session; M8-12 table code (not open → refused, wrong code → refused, right code → order); tenant isolation; M8-10/11 kitchen and café tickets contain only their own items, PDF valid, ESC/POS bytes (init, items, note, cut) |
| `tests/e2e/bills.spec.ts` | Browser: ticket PDF + print page, merged bill 19,50 €, owner reduces an item with reason → 13,00 €, split payment by item (cash) and by amount (card) → 0,00 €, only paid item marked paid, receipt says “NÃO É FATURA / NOT AN INVOICE”, close blocked while preparing, close completes orders, audit entries; table code flow with waiter opening the table |

Still manual: printing on a real thermal printer (ESC/POS network sending is not enabled or hardware-tested).

## Run 5 — 2026-10-30 (session 3): M9 Takeaway, delivery, drivers & WhatsApp

| Check | Command | Result |
|---|---|---|
| Type check | `npx tsc --noEmit` | ✅ 0 errors |
| Migration | `20261030061701_delivery_payment_intent` (dev + test) | ✅ applied |
| Unit + integration | `npm test` | ✅ 15 files, **150 tests passed** |
| Browser E2E | `npm run test:e2e` | ✅ **21 tests passed** |

| File | Covers |
|---|---|
| `tests/integration/fulfilment.test.ts` (13) | Pickup slots after lead time inside pickup/opening hours in Europe/Lisbon (winter and summer time), no fake slots after closing; min order and pause enforced; **TEST 8** takeaway → READY → COMPLETED with real customer status; invalid phone and dishes without a takeaway price refused; PT/ES zone pattern validation; **TEST 9** fee from zone, free above threshold, totals computed server-side, address stored normalised; **TEST 10** outside zone and invalid postal code refused, nothing created; zone minimum, unavailable payment option, active-order limit, pause, delivery hours; driver workflow (only assigned driver, only READY→OUT_FOR_DELIVERY→DELIVERED, cash collected → PAID, timestamps); cancellation reason; tenant isolation |
| `tests/e2e/takeaway-delivery.spec.ts` (4) | Owner saves takeaway settings; guest orders pickup from the storefront (takeaway price, dish without takeaway price hidden), staff see name/phone, guest sees “Pronto para levantamento”; owner adds zone (invalid code refused), guest outside zone gets refusal + “choose pickup”, valid code shows fee 2,00 € and total 9,00 € from the server; owner assigns driver, driver (mobile) goes out and delivers with cash → PAID, driver blocked from management; WhatsApp: prefilled wa.me message with items and total, no MenuNiva order created, clear “only sent when you press send”; Glovo/Uber/Instagram links |

Defects fixed: WhatsApp message could be built before the server total loaded (now uses the cart estimate as fallback); driver dropdown offered roles that cannot open the driver screen (now delivery staff only).
Not provided by design: GPS/live location tracking, automatic Glovo/Uber courier dispatch, distance-based fees.

## Run 6 — 2026-10-30 (session 3): M10 Promotions, coupons & reservations

| Check | Command | Result |
|---|---|---|
| Type check | `npx tsc --noEmit` | ✅ 0 errors |
| Unit + integration | `npm test` | ✅ 18 files, **173 tests passed** |
| Browser E2E | `npm run test:e2e` | ✅ **23 tests passed** |

| File | Covers |
|---|---|
| `tests/unit/promotions.test.ts` (8) | Engine: % per line with half-up rounding, 2×1 by unit groups (cheapest free), category-restricted 2×1, fixed amount capped, combo for complete sets, minimum order, non-combinable → single best/priority promotion, combinable stack on the remaining amount only, never above subtotal |
| `tests/integration/promotions.test.ts` (7) | **TEST 11** 10 % table order (OrderDiscount snapshot) and tea 2×1 for takeaway only; client-sent `discountCents` ignored; no double discount; promo code required/wrong code refused; **code usage limit under 3 concurrent orders → 1 succeeds**; start date and minimum; free-delivery threshold after discounts; cross-tenant dishes refused |
| `tests/integration/reservations.test.ts` (8) | Slots only inside bookable hours where the whole visit fits, nothing without hours, closed day, party too large, out of booking window; capacity of overlapping requested/confirmed visits, rejected ones free capacity; **4 concurrent requests for 10 seats → exactly 2 accepted**; idempotency + private token; status transitions + stale updates; **TEST 12** same table cannot hold overlapping reservations incl. buffer, cancellation frees it; **2 simultaneous assignments of one table → 1 succeeds**; tenant isolation |
| `tests/e2e/promotions-reservations.spec.ts` (2) | Owner creates 10 % and a code promotion; guest cart shows discount line and “Poupa 1,30 €”, total 11,70 €; wrong code error; valid code (higher priority, not combined) → 11,00 €, stored order 13,00 − 2,00 = 11,00; guest requests reservation from storefront, staff assign table + confirm, guest page shows CONFIRMED; overlapping second reservation cannot take the same table; full time slot disabled for the next guest |

Note: the first M10 E2E attempt failed only because two Playwright runs were started at the same time (shared port/test DB); the sequential full run passed.

## Run 7 — 2026-10-30 (session 3): M11 Smart Reviews, loyalty & cart suggestions

| Check | Command | Result |
|---|---|---|
| Type check | `npx tsc --noEmit` | ✅ 0 errors |
| Unit + integration | `npm test` | ✅ 22 files, **201 tests passed** |
| Browser E2E | `npm run test:e2e` | ✅ **26 tests passed** |
| Migration | `20261030065012_loyalty_order_link` | ✅ applied to dev and test |

| File | Covers |
|---|---|
| `tests/integration/feedback.test.ts` (11) | **TEST 13** 1★ → private LOW_RATING alert and the Google link is still returned; **TEST 14** 5★ → identical link and identical response shape, no alert; every rating 1–5 gets the same link; no link configured → none for anyone; contact stored only with follow-up, follow-up needs contact; configurable threshold; feedback switch; one feedback per order; invalid ratings; only https Google URLs accepted (M11-01); inbox statuses, alert cleared on status change, internal notes, stats (average, distribution, repeated issues, low-rating resolution), archived hidden; **TEST 15** feedback isolation between restaurants |
| `tests/integration/loyalty.test.ts` (11) | Settings validation, cannot switch on without a reward; earn amounts (stamp / points without delivery fee); explicit consent required, marketing and birthday separate (birthday needs its own consent); existing member's consents never changed from another order page; earn only when COMPLETED and fully PAID, exactly once, in either order; voided payment reverses the earn (ADJUST); join after completion earns immediately; staff redeem needs enough stamps; FIFO expiry (idempotent); **feedback never changes loyalty**; member deletion erases phone/name/birthday and history; staff can withdraw but not grant marketing consent; tenant isolation |
| `tests/unit/upsell.test.ts` (3) + `tests/integration/upsell.test.ts` (3) | Product and category triggers, priority order, max 2; never suggests items in cart, sold out, unavailable or without a price on the channel; dismissed hidden; self-suggestion / duplicate / foreign ids refused; global switch and paused rules; SHOWN/ACCEPTED counters, unknown or paused rule refused; tenant isolation |
| `tests/e2e/reviews-loyalty-upsell.spec.ts` (3) | Guest 1★ (with follow-up) and 5★ both see the same Google link before and after submitting; manager sees low-rating alert, contact, adds note, resolves → alert cleared, repeated issue listed. Owner creates a suggestion; guest cart shows it without adding it; tapping Add opens the dish sheet (required choice) and still adds nothing; “No, thanks” hides it; SHOWN/ACCEPTED recorded. Owner enables loyalty; guest joins from the order page only after ticking consent (marketing unticked by default); member listed 0 / 5; member deleted and personal data erased |

Master-spec test status after Run 7: TEST 1–15, 17, 19 ✅ · TEST 16 partial (Super Admin flow browser test in M12) · TEST 18 partial (analytics in M12) · TEST 20 pending (M13 demo environment).

Defects found and fixed in this run:
- Feedback contact-name field used an English/Portuguese hard-coded placeholder; now translated in all 5 languages.

Note: an intermediate run failed because Vitest and Playwright were started at the same time on the shared test database; the sequential runs above passed.

## Run 8 — 2026-10-30 (session 4): M12 Analytics, subscriptions, plans & SaaS administration

| Check | Command | Result |
|---|---|---|
| Type check | `npx tsc --noEmit` | ✅ 0 errors |
| Unit + integration | `npm test` | ✅ 25 files, **218 tests passed** |
| Browser E2E | `npm run test:e2e` | ✅ **28 tests passed** |
| Migration | `tenant_disabled_modules` | ✅ applied to dev and test |

| File | Covers |
|---|---|
| `tests/unit/modules-analytics.test.ts` (5) | Effective modules (plan, add-ons, switched off, trial with/without all modules, no plan); "today" differs between Lisbon and Madrid at the same instant; 7/30-day ranges include today; custom range inclusive and ordered; 25-hour DST day; invalid dates fall back; >1 year refused; CSV quoting and formula neutralisation |
| `tests/integration/analytics.test.ts` (5) | **TEST 18** order value 67,60 vs collected 21,90 (voided payment excluded) vs unpaid 45,70 (16,90 on a completed order) vs cancelled 16,90; payments by method; average order; channels; top dish/category. Orders at 22:30 and 23:30 UTC fall on different Madrid days and hours. Reservations, feedback and suggestion figures from stored rows. CSV columns and values incl. cancelled row. **TEST 15** analytics/CSV isolation |
| `tests/integration/plans-modules.test.ts` (7) | **TEST 16 (modules)** new tenant trial → all 12 modules; expired trial → starter modules only; ACTIVE starter refuses takeaway orders, promotions, suggestions, loyalty and stops applying an existing promotion while table ordering still works; Super Admin add-on + switch-off stored relative to the base and kept after upgrade; switching off a non-plan module during a trial persists after upgrade until switched on; platform config (trial length used for new tenants, trials limited to plan, validation); dish limit for new and un-archived dishes with live usage; manual billing record/void, metrics, processor webhook refused (501) |
| `tests/e2e/analytics-subscription.spec.ts` (2) | Guest order 13,00 → analytics shows order value 13,00, collected 0,00, unpaid 13,00; after a 5,00 payment collected 5,00 / unpaid 8,00 / order value unchanged; 7-day view; CSV download row with value/paid/unpaid. Super Admin switches Promotions off and records a 49,00 payment → owner nav hides Promotions, direct URL explains it is not in the plan, subscription page shows Starter / trialing / promotions off / loyalty on (trial) / dishes 2 / 250 / billing row; waiter cannot open Subscription; pausing self-registration shows the closed notice |

Master-spec test status after Run 8: TEST 1–19 ✅ · TEST 20 pending (M13 demo environment).

Defects found and fixed in this run:
- Super Admin module checkboxes ignored the trial: switching off a module outside the plan during a trial was silently not saved. Module changes are now stored as differences from what the tenant gets anyway.
- A new E2E that promoted a user to Super Admin broke the first-admin bootstrap test; the spec now restores the user's role afterwards.

