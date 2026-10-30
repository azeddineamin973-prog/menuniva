# MenuNiva — Feature Traceability Matrix

Maps every Master Specification requirement to milestone, tasks, implementation files,
tests and status.

Status values (never a generic "Complete"):
- **NOT STARTED**
- **IN PROGRESS**
- **WORKING** — implemented and manually exercised, automated test not yet complete
- **TESTED** — implemented and covered by passing automated tests (see QA_REPORT.md)
- **NEEDS CONFIGURATION** — works once the restaurant/operator provides credentials or settings
- **BLOCKED BY EXTERNAL APPROVAL** — requires a third party (Glovo, Uber, payment, invoicing)
- **FUTURE INTEGRATION** — interface prepared, real integration intentionally later

| Spec part | Feature | Milestone | Tasks | Implementation | Tests | Status |
|---|---|---|---|---|---|---|
| 1 | Next.js + TS + Tailwind + PostgreSQL + Prisma + Zod stack | M1 | M1-01..03 | `package.json`, `prisma/`, `scripts/db-local.mjs` | build + all tests | TESTED |
| 1 | `.env.example`, no secrets in browser | M1 | M1-04 | `.env.example`, `src/server/env.ts` | bundle grep (QA Run 1) | TESTED |
| 2A | Dashboard design system (graphite/lime, light/dark) | M1 | M1-07, M1-09 | `src/app/globals.css`, `src/components/ui`, `src/components/dashboard` | E2E renders | TESTED |
| 2B | Restaurant-branded customer menu (Moroccan preset) | M1/M6 | M1-08, M6-07 | `src/components/storefront/*`, `settings/branding` | E2E | TESTED |
| 2 | Original MenuNiva logo + favicon | M1 | M1-06 | `src/components/brand/logo.tsx`, `src/app/icon.svg`, `apple-icon.tsx` | HTTP 200 + visual | TESTED |
| 3 | Platform → Organization → Location hierarchy | M2 | M2-01 | `prisma/schema.prisma` | tenancy.test.ts | TESTED |
| 3 | Tenant isolation (server + data layer) | M2 | M2-09, M2-15 | `src/server/tenant.ts`, all services | TEST 1, 15 (orders) | TESTED |
| 3 | 7 roles, server-enforced permissions | M2 | M2-08, M3-10 | `src/lib/permissions.ts`, `src/lib/nav.ts` | unit + integration | TESTED |
| 3, 23 | Onboarding wizard (10 steps, drafts, progress) | M3 | M3-01..04 | `onboarding/new`, `dashboard/[org]/setup/*`, `setup-progress.ts` | E2E + integration | TESTED |
| 4 | Five languages + Arabic RTL (customer) | M1/M6 | M1-10, M6-07 | `src/i18n/*` | unit + E2E TEST 3 | TESTED |
| 4 | Admin localization | M4 | M4-15 | nav + auth localized; other admin text English | — | TESTED (staff operational screens; owner settings screens English) |
| 4 | Language settings (default/enabled/source) | M4 | M4-13 | `settings/page.tsx`, `services/settings.ts` | — | TESTED |
| 4 | Translation provider abstraction, "Translation required", review | M4 | M4-10..12 | `src/server/translation`, `services/translations.ts`, `menu/translations` | menu.test.ts | TESTED (manual editor) |
| 4 | Machine translation via DeepL/LibreTranslate | M4 | M4-10 | provider abstraction (`getTranslationProvider`); results saved as MACHINE and hidden from guests until reviewed | menu.test.ts (MACHINE translations hidden from guests) | NEEDS CONFIGURATION |
| 5 | Import adapters (CSV, XLSX, PDF, image, text, manual) | M5 | M5-02..07 | `src/server/import/{adapters,tabular,xlsx,text}.ts` | import-parsers.test.ts, import.test.ts, import-studio.spec.ts | TESTED |
| 5 | Glovo partner API import | M5 | M5-08 | — | import-parsers.test.ts, import.test.ts, import-studio.spec.ts | BLOCKED BY EXTERNAL APPROVAL (merchant export import TESTED) |
| 5 | Uber Eats Menu API import | M5 | M5-09 | — | import-parsers.test.ts, import.test.ts, import-studio.spec.ts | BLOCKED BY EXTERNAL APPROVAL (merchant export import TESTED) |
| 5 | Image OCR | M5 | M5-07 | `ImageMenuImporter` in `adapters.ts` | import-parsers.test.ts, import.test.ts, import-studio.spec.ts | NEEDS CONFIGURATION (honest fallback TESTED) |
| 5 | Duplicate detection/merge, preview, publish, rollback | M5 | M5-11..14 | `src/server/import/{dedupe,service}.ts`, `dashboard/[org]/import/*` | import-parsers.test.ts, import.test.ts, import-studio.spec.ts | TESTED |
| 5, 25 | SSRF protection for URL import | M5 | M5-10 | `src/server/import/safe-fetch.ts` | import-parsers.test.ts, import.test.ts, import-studio.spec.ts | TESTED |
| 6 | Categories, products, photos, tags, featured, display order | M4 | M4-02..04 | `services/menu.ts`, `dashboard/[org]/menu/*` | E2E + integration | TESTED |
| 6 | Variants, modifier groups, min/max | M4 | M4-06 | `services/menu.ts`, `options-editor.tsx`, `pricing.ts` | integration | TESTED |
| 6 | Availability schedules, sold out, archive | M4 | M4-08 | sold out/archive done; schedules enforced but no editor UI | TEST 17 | TESTED |
| 6 | Channel prices DINE_IN/TAKEAWAY/DELIVERY, external prices separate | M4 | M4-05 | `ChannelPrice`, `ProductLocationOverride` (no UI yet), `ExternalSourcePrice` | integration | TESTED |
| 6 | Integer-cent money, server-side totals | M4/M6 | M4-01, M6-10 | `src/lib/money.ts`, `services/pricing.ts` | unit + integration | TESTED |
| 6 | Allergens with verification before publishing | M4 | M4-07 | `allergen-editor.tsx`, `public-menu.ts` | menu.test.ts | TESTED |
| 6 | Quick mobile price/availability editing | M4 | M4-09 | `menu/quick/page.tsx` | — | TESTED |
| 7 | Tables, areas, QR tokens, PNG/SVG/PDF | M6 | M6-01..04 | `services/tables.ts`, `dashboard/[org]/tables/*`, `api/dashboard/[org]/qr/*` | E2E | TESTED |
| 7 | Table ordering flow (scan → order → track) | M6/M7 | M6-06..11, M7-01, M7-03 | `t/[token]`, `menu-app.tsx`, `services/orders.ts`, `o/[token]` | TEST 4, 6 (E2E) | TESTED |
| 7, 8 | Call waiter / request bill | M8 | M8-03, M8-04 | `services/staff-tasks.ts`, live board | integration + E2E | TESTED |
| 8 | Order state machine, Kanban, alerts | M7 | M7-02, M7-04, M7-05 | `lib/order-state.ts`, `orders/live-board.tsx` | TEST 6 + E2E | TESTED |
| 8 | Idempotency, transactions, snapshots, availability check | M7 | M7-01 | `services/orders.ts` | TEST 7, 17 | TESTED |
| 8, 27 | Labelled polling, connection health, reconnection | M7 | M7-10 | `use-polling.tsx` | — | TESTED |
| 9 | KDS stations, routing, readiness aggregation | M7 | M7-06..09 | `stations/page.tsx`, `kitchen/*`, `services/orders.ts` | TEST 5 (E2E) | TESTED |
| Add-1 | Session merge, item modify/cancel w/ audit, transfer, split bills, partial payments | M8 | M8-01..08, M8-12 | `services/bills.ts`, `dashboard/[org]/bills/*` | bills.test.ts, bills.spec.ts | TESTED |
| Add-2 | Kitchen/café ticket printing (PDF/print first) | M8 | M8-10 | `server/printing`, `services/tickets.ts`, `kitchen/tickets/*/print`, ticket PDF route | bills.test.ts, bills.spec.ts | TESTED |
| Add-2 | Direct thermal printer integration | M8 | M8-11 | ESC/POS formatter in `server/printing` (sending not enabled) | unit (bytes) | NEEDS CONFIGURATION (hardware untested) |
| 10 | Takeaway (pickup hours, lead time, min, pause) | M9 | M9-01..03 | `services/fulfilment.ts`, `r/[org]/order/[mode]`, `dashboard/[org]/takeaway` | TEST 8 (integration + E2E) | TESTED |
| 11 | Delivery zones (PT/ES postal codes), fees, workflow, driver view | M9 | M9-04..08, M9-11 | `services/fulfilment.ts`, `dashboard/[org]/delivery`, `dashboard/[org]/driver` | TEST 9, 10 (integration + E2E) | TESTED (no GPS, no courier dispatch — by design) |
| 12 | WhatsApp prefilled ordering + external links | M9 | M9-09, M9-10 | `buildWhatsAppText` in `menu-app.tsx`, storefront links | takeaway-delivery.spec.ts | TESTED |
| 13 | Promotions & coupons (server-side) | M10 | M10-01..04 | `src/lib/promotions.ts`, `services/promotions.ts`, `dashboard/[org]/promotions` | TEST 11 (unit + integration + E2E) | TESTED |
| 14 | Reservations with double-booking prevention | M10 | M10-05..09 | `services/reservations.ts`, `r/[org]/reserve`, `reservation/[token]`, `dashboard/[org]/reservations` | TEST 12 (integration + E2E) | TESTED (no SMS by design) |
| 15 | Smart Reviews, no gating, equal Google link | M11 | M11-01..05 | `services/feedback.ts`, `api/public/feedback`, `r/[org]/feedback`, `dashboard/[org]/reviews` | TEST 13, 14 (integration + E2E) | TESTED |
| 16 | Loyalty (voluntary, consent, separate marketing opt-in) | M11 | M11-06..08 | `services/loyalty.ts`, `api/public/loyalty`, `o/[token]/loyalty-card.tsx`, `dashboard/[org]/loyalty` | `loyalty.test.ts` (integration) + E2E | TESTED |
| 17 | Smart Upsell (deterministic, never auto-add) | M11 | M11-09, M11-10 | `src/lib/upsell.ts`, `services/upsell.ts`, `api/public/upsell`, `dashboard/[org]/menu/upsell`, cart in `menu-app.tsx` | unit + integration + E2E | TESTED |
| 18 | Analytics (paid vs unpaid), CSV export | M12 | M12-01..04 | `services/analytics.ts`, `dashboard/[org]/analytics`, `api/dashboard/[org]/analytics/export` | TEST 18 (unit + integration + E2E) | TESTED |
| 19 | Pay at counter / waiter / cash on delivery, manual payment records | M8/M9 | M8-08, M9-11 | `services/bills.ts` (recordPayment, voidPayment), `fulfilment.ts` (driverUpdate cash) | bills.test.ts, bills.spec.ts, takeaway-delivery.spec.ts | TESTED |
| 19 | Online payments (MB WAY, Multibanco, cards, Bizum) | — | — | `server/payments/providers.ts` (interface, not connected) | — | BLOCKED BY EXTERNAL APPROVAL |
| 19 | Certified invoicing (PT AT / ES Verifactu) | — | — | `server/payments/providers.ts` (interface); receipt labelled not an invoice | bills.spec.ts | BLOCKED BY EXTERNAL APPROVAL |
| 19 | SaaS plans, trials, manual subscriptions, limits, module toggles | M12 | M2-13, M12-05..06, M12-09 | `services/plans.ts`, `services/limits.ts`, `src/lib/modules.ts`, `server/modules.ts`, `dashboard/[org]/subscription`, `admin/tenants/[id]` | `plans-modules.test.ts` + TEST 16 E2E | TESTED |
| 19 | SaaS billing adapter (manual records today; processor webhooks refused) | M12 | M12-07 | `src/server/billing/index.ts`, `api/billing/webhook`, admin billing records | integration | NEEDS CONFIGURATION (processor) |
| 20 | Restaurant dashboard sections + role navigation | M3–M12 | M3-10, M12-09 | `dashboard/[org]/layout.tsx` (filtered by permission and module; every section has a page) | role E2E + TEST 16 E2E | TESTED |
| 21 | Super Admin (secure bootstrap, audit, tenants, plans, metrics, platform settings) | M2/M12 | M2-11, M2-12, M12-08 | `src/app/admin/*`, `services/admin.ts`, `platform-setup.ts`, `services/platform-config.ts` | bootstrap + plans-modules integration, TEST 16 E2E | TESTED |
| 22 | Public storefront `/r/[slug]`, SEO, custom-domain ready | M6 | M6-05 | `r/[org]/[[...location]]` (title, description, OG, JSON-LD, canonical) | — | TESTED |
| 24 | Normalized schema, migrations, indexes, safe migration procedure | M2/M13 | M2-01, M13-07 | `prisma/schema.prisma`, `prisma/migrations/`, `scripts/migrate-safe.mjs` | migrations.test.ts (lint), backup-restore.test.ts, scratch-DB run | TESTED |
| 25 | Auth, sessions, CSRF, rate limiting, audit, uploads | M2/M3 | M2-03..10, M3-05 | `src/server/auth/*`, `http.ts`, `rate-limit.ts`, `audit.ts`, `storage.ts` | integration + curl | TESTED |
| 25 | GDPR export/deletion, retention | M13 | M13-02 | `services/privacy.ts`, `settings/privacy`, `api/dashboard/[org]/privacy/export`, `scripts/retention.ts` | privacy.test.ts | TESTED |
| 25 | Authorization on every page, route and action | M13 | M13-01 | `tenant.ts`, `route-tenant.ts`, `action.ts`, admin guards on every admin page | route-audit.test.ts (static), route-audit.spec.ts (runtime), login.test.ts | TESTED |
| 26 | PT/ES country config, IVA classes, address formats | M3/M4 | M3-03, M4-14 | postal formats, time zones, restaurant-approved IVA classes | unit + menu-advanced.test.ts | TESTED |
| 27 | Persistent orders, acknowledgment, unread counters | M7 | M7-05 | `orders.ts`, `live-board.tsx`, sidebar badge | E2E | TESTED |
| 28 | Separate demo environment (labelled fake data) | M13 | M13-10 | `scripts/seed-demo.ts`, `menuniva_demo`, DEMO banner (`APP_ENV=demo`), `playwright.demo.config.ts` | TEST 20 (demo-flow.spec.ts) | TESTED |
| Add-3 | Backups, environments, monitoring, health checks, deploy checklist | M13 | M13-03..07, M13-11 | `scripts/backup.mjs`, `restore.mjs`, `lib/backup-core.mjs`, `env.ts` (environment rules), `monitoring.ts`, `instrumentation.ts`, `/api/health`, `docs/DEPLOYMENT.md` | backup-restore.test.ts, environments.test.ts, monitoring.test.ts | TESTED (no hosting deployed yet; external DSN unverified) |
| Add-4 | Mobile usability (360 px) for guest and staff screens | M13 | M13-08 | responsive layouts; 24 px minimum tap targets on guest screens | mobile-pass.spec.ts | TESTED |

_Last updated: 2026-10-30 (session 5). Casa de Marrocos tenant: created via `scripts/bootstrap-casa-de-marrocos.ts` — WORKING (verified in DB)._
