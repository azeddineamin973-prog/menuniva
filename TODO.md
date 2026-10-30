# MenuNiva — Master Task List

Status legend
- `[ ]` NOT STARTED
- `[~]` IN PROGRESS
- `[x]` COMPLETED AND VERIFIED (acceptance criteria verified; evidence in `QA_REPORT.md`)
- Labels: **BLOCKED**, **NEEDS CONFIGURATION**, **REQUIRES EXTERNAL APPROVAL**

Priority: P0 = vertical slice / foundation, P1 = required for launch, P2 = valuable, can follow.
Each line: ID · task — Priority · Deps · **AC** acceptance criteria · **Verify** method.
Execution order: M1 → M2 → M3 → M4 → M6 → M7 → M5 → M8 → M9 → M10 → M11 → M12 → M13 (see docs/ROADMAP.md).

---

## M1 — Project Setup, Architecture, Branding & Design System

- [x] **M1-01** Inspect environment, create project folder, init git — P0 · Deps: — · **AC** project in `~/Desktop/saas/menuniva`, other Niva projects untouched · **Verify** `ls`, `git status`
- [x] **M1-02** Install pinned, mutually compatible stack — P0 · Deps: M1-01 · **AC** Next 16.4.3, React 19.3.1, TS 5.9.3, Tailwind 4.3.3, Prisma 7.10.1, Zod 4.6.7, Vitest 4.1.12, Playwright 1.64.1 installed · **Verify** `npm ls`
- [x] **M1-03** Local PostgreSQL without system installs — P0 · Deps: M1-02 · **AC** `npm run db:local` starts PostgreSQL 18; dev/test/demo databases exist · **Verify** process log + migration applied
- [x] **M1-04** Environment config: `.env.example` + server-only Zod env validation — P0 · Deps: M1-02 · **AC** app fails fast with readable error if required env missing; no secrets in client bundle · **Verify** unit test + build output grep
- [x] **M1-05** Architecture document `docs/ARCHITECTURE.md` — P0 · Deps: M1-02 · **AC** describes layers, tenancy, auth, money, i18n, adapters · **Verify** review
- [x] **M1-06** Original MenuNiva logo, favicon and app icons — P1 · Deps: M1-02 · **AC** SVG mark (card + QR + cloche motif), `Logo` component, `icon.svg`, `apple-icon` · **Verify** visual check in browser
- [x] **M1-07** Dashboard design tokens + UI primitives (graphite #171A1D, lime #B9FF36, light/dark) — P0 · Deps: M1-02 · **AC** Button, Card, Input, Select, Badge, Field, EmptyState, Alert primitives; accessible focus states · **Verify** render on pages; Playwright smoke
- [x] **M1-08** Per-tenant storefront theme (CSS variables) + Moroccan preset — P1 · Deps: M1-07 · **AC** branding colors/fonts applied per restaurant; Moroccan pattern is subtle SVG · **Verify** storefront render
- [x] **M1-09** Responsive dashboard shell (sidebar, mobile nav, theme toggle) — P0 · Deps: M1-07 · **AC** works ≥320px wide; dark mode persists · **Verify** Playwright mobile viewport
- [x] **M1-10** i18n foundation: 5 locales (pt-PT, en, fr, ar, es), RTL for Arabic — P0 · Deps: M1-02 · **AC** central dictionaries with identical keys; `dir="rtl"` for ar · **Verify** unit test key parity + E2E
- [x] **M1-11** Test harness: Vitest against `menuniva_test`, Playwright with system Chrome — P0 · Deps: M1-03 · **AC** `npm test` and `npm run test:e2e` run real DB tests · **Verify** test runs
- [x] **M1-12** MenuNiva public home page (product presentation, honest claims) — P2 · Deps: M1-07 · **AC** no fake customers/testimonials · **Verify** visual check
- [x] **M1-13** Milestone gate: typecheck, build, tests, git commit — P0 · Deps: M1-01..12 · **AC** all pass · **Verify** QA_REPORT entry

## M2 — Database, Authentication, Multi-Tenancy & Super Admin

- [x] **M2-01** Normalized, indexed PostgreSQL schema + init migration — P0 · Deps: M1-03 · **AC** all spec entities (adapted names documented), FKs, indexes, integer cents · **Verify** `prisma migrate dev` applied
- [x] **M2-02** Prisma client singleton with pg adapter, test DB switching — P0 · Deps: M2-01 · **AC** single pool in dev hot-reload; tests use TEST_DATABASE_URL · **Verify** integration test
- [x] **M2-03** Password hashing (argon2id) and password policy — P0 · Deps: M2-02 · **AC** min 10 chars; hashes never logged · **Verify** unit test
- [x] **M2-04** DB-backed sessions with hashed tokens, secure cookies, expiry, sliding refresh — P0 · Deps: M2-03 · **AC** httpOnly, SameSite=Lax, Secure in production; logout deletes session · **Verify** integration test
- [x] **M2-05** Sign-up, login, logout pages — P0 · Deps: M2-04 · **AC** generic error on bad credentials; disabled users blocked · **Verify** E2E
- [x] **M2-06** CSRF / origin protection for mutating route handlers — P0 · Deps: M2-04 · **AC** cross-origin POST rejected; server actions use Next origin check · **Verify** integration test
- [x] **M2-07** Rate limiting (PostgreSQL buckets) for auth and public endpoints — P0 · Deps: M2-02 · **AC** limits per IP/key; 429 response · **Verify** unit/integration test
- [x] **M2-08** Role & permission matrix (7 roles) — P0 · Deps: M2-01 · **AC** single source of truth, server enforced · **Verify** unit test
- [x] **M2-09** Tenant context: `requireTenant(orgSlug, permission)` on every protected page/action — P0 · Deps: M2-04, M2-08 · **AC** browser-supplied IDs always re-checked against membership · **Verify** isolation tests
- [x] **M2-10** Audit log service — P0 · Deps: M2-02 · **AC** admin & sensitive staff actions recorded with actor, entity, metadata · **Verify** integration test
- [x] **M2-11** Super Admin one-time bootstrap (CLI token → `/setup`) — P0 · Deps: M2-04 · **AC** no default password; token single-use, expires 1 h, hashed in DB · **Verify** integration test + manual run
- [x] **M2-12** Super Admin dashboard: tenants, create/activate/suspend, assign plan, trials, modules — P1 · Deps: M2-11, M2-13 · **AC** non-admins get 404/403; every action audited · **Verify** E2E (TEST 16 part)
- [x] **M2-13** Configurable subscription plans (Starter, Growth, Pro, Enterprise) seed — P1 · Deps: M2-01 · **AC** names/limits editable; prices marked "not final" · **Verify** DB check
- [x] **M2-14** Password reset (token; email if SMTP configured, otherwise admin-generated link) — P1 · Deps: M2-04 · **AC** token single-use, 30 min expiry; sessions revoked after reset · **Verify** integration test
- [x] **M2-15** Tenant isolation integration tests (TEST 1, TEST 15 base) — P0 · Deps: M2-09 · **AC** Restaurant A cannot read/mutate B data · **Verify** Vitest
- [x] **M2-16** Milestone gate — P0 · Deps: M2-* · **AC** all pass, commit · **Verify** QA_REPORT

## M3 — Restaurant Onboarding, Settings & Staff Roles

- [x] **M3-01** Restaurant registration: org + first location + owner membership + trial — P0 · Deps: M2-09, M2-13 · **AC** one transaction; slug unique · **Verify** integration test
- [x] **M3-02** 10-step onboarding wizard framework with progress + saved drafts — P0 · Deps: M3-01 · **AC** steps: details, branding, import menu, translations, prices, tables, channels, kitchen, preview, publish · **Verify** E2E
- [x] **M3-03** Step 1 restaurant details: country, language, address, phone, time zone, PT/ES postal validation — P0 · Deps: M3-02 · **AC** PT `NNNN-NNN`, ES `NNNNN` · **Verify** unit tests
- [x] **M3-04** Step 2 branding: logo/cover upload, colors, theme preset — P1 · Deps: M3-05 · **AC** preview updates; only validated images stored · **Verify** E2E
- [x] **M3-05** Safe file upload service (magic-byte check, size limit, random names, storage abstraction) — P0 · Deps: M2-09 · **AC** rejects SVG/HTML/oversized; serves with correct content-type · **Verify** unit tests
- [x] **M3-06** Restaurant & location settings pages (opening hours editor, contact, social, ordering channels) — P1 · Deps: M3-01 · **AC** opening hours entered by restaurant, never invented · **Verify** E2E
- [x] **M3-07** Multi-location management — P2 · Deps: M3-06 · **AC** create/edit locations; plan limit respected · **Verify** integration test
- [x] **M3-08** Staff invitations + acceptance flow — P1 · Deps: M3-01 · **AC** role + location scope; link shown if no SMTP · **Verify** integration test
- [x] **M3-09** Staff management (change role, disable, remove) — P1 · Deps: M3-08 · **AC** managers cannot promote to owner; last owner protected · **Verify** integration test
- [x] **M3-10** Role-based navigation + role landing pages — P0 · Deps: M2-08 · **AC** kitchen sees KDS only; delivery staff sees deliveries only; server still enforces · **Verify** E2E
- [x] **M3-11** Casa de Marrocos tenant bootstrap (`npm run setup:casa`) — P0 · Deps: M3-01 · **AC** real name/address/phone; areas Main dining room, Moroccan seating area, Indoor terrace, Moroccan tent/café; stations Downstairs kitchen, Café; Europe/Lisbon; NO dishes, prices, tables, hours · **Verify** DB check
- [x] **M3-12** Tests: onboarding, invitations, permissions — P0 · Deps: M3-* · **AC** pass · **Verify** Vitest/Playwright
- [x] **M3-13** Milestone gate — P0

## M4 — Menu Management, Five Languages & Translation System

- [x] **M4-01** Money utilities (parse "16,90" → 1690, format per locale, integer-only math) — P0 · Deps: M1-02 · **AC** no float in totals; rounding rule documented · **Verify** unit tests
- [x] **M4-02** Menu service: categories & products CRUD, tenant-scoped — P0 · Deps: M2-09 · **AC** every query filters by organizationId · **Verify** integration tests
- [x] **M4-03** Category management UI (reorder, translations, default station) — P0 · Deps: M4-02 · **Verify** E2E
- [x] **M4-04** Product editor (per-language names/descriptions/ingredients, image, tags, featured/popular, station) — P0 · Deps: M4-02, M3-05 · **Verify** E2E
- [x] **M4-05** Channel prices DINE_IN/TAKEAWAY/DELIVERY + location overrides — P0 · Deps: M4-01 · **AC** imported platform prices never overwrite in-house prices · **Verify** integration test
- [x] **M4-06** Variants and modifier groups (min/max, required/optional, option max qty) — P0 · Deps: M4-04 · **Verify** integration test
- [x] **M4-07** Allergen declarations (14 EU allergens) with explicit verification — P0 · Deps: M4-04 · **AC** unverified/imported/AI suggestions never shown to customers as statements · **Verify** integration test
- [x] **M4-08** Availability schedules, temporary sold-out, archive, display order — P1 · Deps: M4-04 · **Verify** integration test (TEST 17 part)
- [x] **M4-09** Quick mobile price & availability editor — P1 · Deps: M4-05 · **Verify** Playwright mobile
- [x] **M4-10** Translation provider abstraction (none / DeepL / LibreTranslate) with honest status — P0 · Deps: M4-02 · **AC** without config: original kept, others "Translation required"; machine output marked MACHINE (unreviewed) · **Verify** unit tests
- [x] **M4-11** Translation editor grid + bulk translate when configured — P0 · Deps: M4-10 · **AC** never translates allergen/ingredient safety data automatically · **Verify** E2E
- [x] **M4-12** Review-before-publish screen for menu & translations — P0 · Deps: M4-11 · **Verify** E2E
- [x] **M4-13** Language settings: default, enabled, source language — P0 · Deps: M4-02 · **Verify** E2E
- [x] **M4-14** Tax classes per country (restaurant-approved, no single hardcoded rate) — P1 · Deps: M4-02 · **Verify** integration test
- [x] **M4-15** Localize key admin screens in 5 languages — P1 · Deps: M1-10 · **Verify** key parity test
- [x] **M4-16** Tests + milestone gate — P0

## M5 — Magic Import Studio (executed after M7)

- [x] **M5-01** Import job service (DRAFT → NEEDS_REVIEW → PUBLISHED / CANCELLED / FAILED) — P0 · Deps: M4-02
- [x] **M5-02** Adapter interface + registry: GlovoCatalogAdapter, UberEatsMenuAdapter, CSVImporter, ExcelImporter, PDFMenuImporter, ImageMenuImporter, TextMenuImporter — P0 · **AC** "Connected" only for genuine working connections
- [x] **M5-03** CSVImporter (delimiter detection, PT decimal comma, header mapping) — P0 · **Verify** unit tests
- [x] **M5-04** ExcelImporter (XLSX) — P1 · **Verify** unit tests
- [x] **M5-05** TextMenuImporter (pasted text heuristics) — P1 · **Verify** unit tests
- [x] **M5-06** PDFMenuImporter: native text extraction; scanned PDFs → clear fallback — P1 · **Verify** unit tests
- [x] **M5-07** ImageMenuImporter: OCR only if configured; otherwise honest fallback — P2 · fallback verified; OCR engine itself **NEEDS CONFIGURATION**
- [x] **M5-08** GlovoCatalogAdapter: partner API when credentials exist; merchant export/paste otherwise — P1 · merchant export/paste + honest status verified; partner API **REQUIRES EXTERNAL APPROVAL**
- [x] **M5-09** UberEatsMenuAdapter: same model — P1 · merchant export/paste + honest status verified; Menu API **REQUIRES EXTERNAL APPROVAL**
- [x] **M5-10** SSRF-safe URL validation/fetch (no private IPs, redirect limit, timeout, size cap) — P0 · **Verify** unit tests
- [x] **M5-11** Duplicate detection & merge suggestions across sources and existing products — P1
- [x] **M5-12** Import preview UI (items, categories, images, missing info, duplicates, translation status, warnings) — P0
- [x] **M5-13** Review decisions & canonical selection; external prices stored as reference only — P0
- [x] **M5-14** Publish in one transaction; cancel/rollback unpublished; never silent overwrite — P0
- [x] **M5-15** Tests: TEST 2, TEST 19 — P0
- [x] **M5-16** Milestone gate — P0

## M6 — QR Codes, Tables, Customer Menu & Shopping Cart

- [x] **M6-01** Dining areas & tables service (tenant/location scoped) — P0 · Deps: M3-01
- [x] **M6-02** Tables & areas dashboard (bulk add, labels, seats, active) — P0 · Deps: M6-01
- [x] **M6-03** Secure QR tokens (random 128-bit, rotatable) + SVG/PNG download — P0 · **AC** no DB IDs in QR URL · **Verify** unit test
- [x] **M6-04** Printable QR sheet (HTML print + PDF with table labels) — P1
- [x] **M6-05** Public storefront `/r/[restaurant]` and `/r/[restaurant]/[location]` with branding + SEO (title, description, OG, JSON-LD Restaurant, canonical) — P0
- [x] **M6-06** Table entry `/t/[token]`: resolve location+table, open/attach table session — P0
- [x] **M6-07** Mobile customer menu: categories, products, images, verified allergens only, language switch, RTL — P0
- [x] **M6-08** Product customization sheet (variants, modifiers with min/max) — P0
- [x] **M6-09** Cart (per location+channel, persisted locally, editable) — P0
- [x] **M6-10** Server pricing engine (`quoteOrder`) — authoritative integer-cent totals — P0 · **AC** client prices ignored · **Verify** unit/integration tests
- [x] **M6-11** Checkout review: allergy notice, kitchen notes, totals from server — P0
- [x] **M6-12** Tests: TEST 3 (5 languages + RTL), quote tampering test — P0
- [x] **M6-13** Milestone gate — P0

## M7 — Direct Ordering, Live Dashboard, Kitchen & Café

- [x] **M7-01** Order submission: transaction, idempotency key, price snapshots, availability check, throttling, order number sequence — P0
- [x] **M7-02** Order state machine per channel (explicit valid transitions, event log) — P0
- [x] **M7-03** Customer order tracking via scoped token (polling, real status) — P0
- [x] **M7-04** Live orders Kanban (New, Accepted, Preparing, Ready, Completed) with labelled polling — P0
- [x] **M7-05** Alerts: unread counter, persistent NEW until acknowledged, sound, browser notification, mute setting — P0
- [x] **M7-06** Kitchen stations management — P0
- [x] **M7-07** Station routing: product station → category default → none (expo) — P0
- [x] **M7-08** KDS per station: fullscreen, pending/preparing/ready, notes, elapsed time — P0
- [x] **M7-09** Order readiness aggregation (READY only when every station ticket is ready) — P0
- [x] **M7-10** Connection health indicator, reconnection, duplicate-safe status updates — P0
- [x] **M7-11** Tests: TEST 4, 5, 6, 7, 17 — P0
- [x] **M7-12** Vertical slice E2E (menu → QR → order → kitchen/café → complete) — P0
- [x] **M7-13** Milestone gate — P0

## M8 — Table Sessions, Bills, Waiter Requests & Kitchen Printing

- [x] **M8-01** Table session lifecycle (open on first scan/order, staff close) — P0
- [x] **M8-02** Merge all orders in an active session into one bill view — P0
- [x] **M8-03** Customer "Call waiter" / "Request bill" → StaffTask (throttled) — P0
- [x] **M8-04** Waiter tasks panel (acknowledge, done) — P0
- [x] **M8-05** Modify/cancel order items with audit trail — P1
- [x] **M8-06** Transfer open session to another table (audited) — P1
- [x] **M8-07** Split bill by items or by amount; partial payments — P1
- [x] **M8-08** Manual payment recording; payment status separate from order status — P0
- [x] **M8-09** Internal receipt labelled "Not an invoice" — P1
- [x] **M8-10** Printable kitchen & café tickets (HTML print + PDF) — P1
- [x] **M8-11** Printer integration interface (thermal) — P2 · interface + ESC/POS formatter unit-tested; direct printing **NEEDS CONFIGURATION** (untested with real hardware)
- [x] **M8-12** Optional table-session verification code — P2
- [x] **M8-13** Tests + milestone gate — P0

## M9 — Takeaway, Delivery Zones, Staff Delivery & WhatsApp

- [x] **M9-01** Takeaway settings (pickup hours, lead time, min order, pause) — P0
- [x] **M9-02** Pickup slot generation in location time zone — P0
- [x] **M9-03** Takeaway checkout (name, phone, slot) — P0
- [x] **M9-04** Delivery settings + named zones with postal-code patterns and fees — P0
- [x] **M9-05** PT/ES postal code validation and matching — P0
- [x] **M9-06** Delivery checkout: coverage check, fee, min order, free threshold, offer takeaway if outside — P0
- [x] **M9-07** Delivery workflow (accept, prepare, ready, assign driver, out for delivery, delivered, cancel w/ reason) — P0
- [x] **M9-08** Driver/staff mobile view — P1
- [x] **M9-09** WhatsApp prefilled order message (opened after user action; never claims sent) — P1
- [x] **M9-10** External links on storefront (Glovo, Uber Eats, website, Instagram, Facebook, TikTok) — P1
- [x] **M9-11** Cash on delivery option — P1
- [x] **M9-12** Tests: TEST 8, 9, 10 + milestone gate — P0

## M10 — Promotions, Coupons & Reservations

- [x] **M10-01** Promotion engine: percentage, fixed, 2×1 / buy X get Y, combo, category, min order, channels, dates, priority, combinability, no negatives — P0
- [x] **M10-02** Coupons with atomic usage limits — P1
- [x] **M10-03** Promotions manager UI — P1
- [x] **M10-04** Customer savings display — P1
- [x] **M10-05** Reservation settings (slots, max party, capacity, buffer, notice) — P1
- [x] **M10-06** Server-side availability check — P1
- [x] **M10-07** Customer reservation request form (5 languages) — P1
- [x] **M10-08** Reservation management: day calendar, accept/reject/confirm/cancel/arrived/no-show — P1
- [x] **M10-09** Table assignment with double-booking prevention (transaction + overlap check) — P1
- [x] **M10-10** Tests: TEST 11, 12 + milestone gate — P0

## M11 — Smart Reviews, Complaint Recovery, Loyalty & Upsell

- [x] **M11-01** Review settings per location (official Google review URL) — P1
- [x] **M11-02** Customer feedback page: stars, categories, comment, follow-up; Google link shown identically to all — P0
- [x] **M11-03** Low-rating manager alerts — P1
- [x] **M11-04** Feedback inbox: notes, statuses NEW/INVESTIGATING/RESOLVED/ARCHIVED — P1
- [x] **M11-05** Repeated-issue analysis by category — P2
- [x] **M11-06** Loyalty program settings (enable/disable, points/stamps, expiry) — P2
- [x] **M11-07** Voluntary enrolment with consent; marketing opt-in separate; optional birthday — P2
- [x] **M11-08** Earn / redeem / expire transactions; never tied to reviews — P2
- [x] **M11-09** Upsell rules (product/category → suggestion) — P1
- [x] **M11-10** Upsell in cart (polite, never auto-adds) + SHOWN/ACCEPTED tracking — P1
- [x] **M11-11** Tests: TEST 13, 14 + milestone gate — P0

## M12 — Analytics, Subscriptions, Plans & SaaS Administration

- [x] **M12-01** Analytics queries (channels, counts, AOV, popular items/categories, hours, zones, discounts, reservations, ratings, complaints, upsell) in location time zone — P1
- [x] **M12-02** Analytics dashboard (Today, 7d, 30d, custom) — P1
- [x] **M12-03** Separate order value / collected payments / cancelled value / unpaid — P0
- [x] **M12-04** CSV export — P1
- [x] **M12-05** Owner subscription page (plan, status, trial, limits, genuine billing history) — P1
- [x] **M12-06** Plan limit enforcement — P1
- [x] **M12-07** Billing provider adapter (manual now; processor + verified webhooks later) — P2 · **NEEDS CONFIGURATION**
- [x] **M12-08** Super Admin: platform metrics (privacy-preserving), errors, integration health, support issues, platform config — P1
- [x] **M12-09** Feature module toggles per tenant — P1
- [x] **M12-10** Tests: TEST 16, 18 + milestone gate — P0

## M13 — Security, Testing, Backups, Deployment & Release Preparation

- [x] **M13-01** Security review: authz on every route/action (automated route audit test) — P0
- [x] **M13-02** GDPR: customer data export/deletion, retention job — P1
- [x] **M13-03** Error monitoring hook (ErrorLog + optional DSN) — P1
- [x] **M13-04** Health check endpoint (`/api/health`: app + DB) — P0
- [x] **M13-05** Backup & restore scripts and documented strategy — P0
- [x] **M13-06** Environments: development, staging, production, demo — P0
- [x] **M13-07** Safe migration procedure (`migrate deploy`, backups first) — P0
- [x] **M13-08** Mobile usability pass (customer + staff screens) — P1
- [x] **M13-09** Full E2E suite TEST 1–20 — P0
- [x] **M13-10** Demo environment seed with clearly labelled fake data (separate DB) — P1
- [x] **M13-11** README, deployment & launch guide, production checklist — P0
- [x] **M13-12** Final QA_REPORT + feature status matrix — P0
- [x] **M13-13** Release commit/tag — P0
