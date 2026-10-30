# MenuNiva — Progress Log

## Current status (session 3 — 2026-10-30)

**Task completion (from TODO.md):** 147 of 169 tasks verified (87.0 %) · 0 in progress · 22 not started.

| Milestone | Verified | Not started | Total | Gate |
|---|---|---|---|---|
| M1 Setup, architecture, branding | 13 | 0 | 13 | ✅ closed |
| M2 DB, auth, tenancy, Super Admin | 16 | 0 | 16 | ✅ closed |
| M3 Onboarding, settings, staff | 13 | 0 | 13 | ✅ closed |
| M4 Menu, 5 languages, translation | 16 | 0 | 16 | ✅ closed |
| M5 Import Studio | 16 | 0 | 16 | ✅ closed (OCR needs configuration; Glovo/Uber APIs need provider approval) |
| M6 QR, tables, customer menu, cart | 13 | 0 | 13 | ✅ closed |
| M7 Ordering, live dashboard, KDS | 13 | 0 | 13 | ✅ closed |
| M8 Sessions, bills, waiter requests, printing | 13 | 0 | 13 | ✅ closed (thermal printer hardware untested) |
| M9 Takeaway, delivery, WhatsApp | 12 | 0 | 12 | ✅ closed |
| M10 Promotions, reservations | 10 | 0 | 10 | ✅ closed |
| M11 Reviews, loyalty, upsell | 11 | 0 | 11 | ✅ closed |
| M12 Analytics, subscriptions, admin | 0 | 10 | 10 | next |
| M13 Security, backups, deployment | 1 | 12 | 13 | |

Tests: 201 unit/integration + 26 browser E2E passing (QA_REPORT.md, Run 7).

## Completed in session 3
- M11: private guest feedback (stars, categories, comment, optional follow-up contact) with the official Google review link shown identically to every guest whatever the rating; low-rating manager alerts (configurable threshold, nav badge); feedback inbox with statuses, internal notes, 30-day stats and repeated issues. Loyalty: stamps or points, voluntary enrolment on the order page with explicit consent, separate marketing and birthday opt-ins, earn only when completed and fully paid (reversed if a payment is voided), staff redeem, FIFO expiry, member deletion; not linked to reviews. Cart suggestions: product/category rules, only available dishes with a channel price, never auto-added, “No, thanks”, anonymous SHOWN/ACCEPTED counts.
- M10: deterministic integer promotion engine (%, fixed, buy X get Y, combo, category, minimum, channels, dates, priority, combinability), promo codes with atomic usage limits, promotions manager, savings in cart/order; reservations with configurable hours/capacity/buffer/notice, server-side availability under lock, guest request + private status page, day view with confirm/reject/arrived/no-show and double-booking-safe table assignment.
- M9: takeaway settings and pickup slots (location time zone), takeaway checkout, PT/ES postal-code delivery zones with fees/minimum/free threshold, delivery checkout with server-side coverage and totals, delivery hours/pause/active-order limit, cash or card on delivery, driver assignment and mobile driver view (cash collection recorded), WhatsApp prefilled orders (not stored), storefront ordering links.
- M8: table sessions (open/close/transfer), merged bills, item reduce/void with audit, split payments by item or amount with row locks, payment voiding, internal receipt (not an invoice), kitchen/café ticket print page + PDF + ESC/POS formatter, optional 4-digit table code, payment and certified-invoicing provider interfaces (not connected).

## Completed in session 2
- Closed all partially verified tasks of M1–M4, M6, M7 with new integration and browser tests.
- New features: per-location availability & prices (M4-05), availability schedules for dishes and categories (M4-08), restaurant-approved IVA tax classes with PT/ES starting points (M4-14), additional locations within plan limits + sidebar location switcher (M3-07), staff operational screens localized in 5 languages (M4-15).
- Fixed: schedules not enforced in server pricing; forms losing values after validation errors.
- M5 Import Studio: CSV, Excel, PDF (native text), pasted text, Glovo/Uber merchant exports; honest statuses (photo OCR not configured, partner APIs need approval, store pages not scraped); SSRF-safe fetch; duplicate detection across sources and against the existing menu; per-item decisions and canonical choice; transactional publish with platform prices kept as references; cancel/rollback.

## Completed in session 1
- Environment inspected; project created in `~/Desktop/saas/menuniva`; no other project touched.
- Local PostgreSQL 18 via `embedded-postgres` (no Homebrew/Docker), databases `menuniva_dev`, `menuniva_test`, `menuniva_demo`.
- Full Prisma schema for all modules (60+ models) and initial migration.
- Auth (argon2id, hashed DB sessions, secure cookies), origin-based CSRF checks, PostgreSQL rate limiting, audit log, error log.
- Role/permission matrix and server-side tenant checks on every page, action and API.
- Super Admin: one-time token bootstrap, tenants list, create tenant, status, manual subscriptions, modules, plans, integration health, errors, support, audit.
- Self-service registration, 10-step setup wizard derived from real data, settings (details, opening hours, languages, branding, channels, links, Google review URL), staff invitations and role management.
- Menu: categories, dishes, per-channel prices in cents, variants, modifier groups, verified-only allergens, photos with rights confirmation, translations editor, honest translation provider abstraction, quick sold-out/price screen.
- Stations, dining areas, tables, QR tokens (rotatable), PNG/SVG/PDF/print sheet.
- Customer: branded mobile menu in 5 languages (Arabic RTL), product customisation, cart, server quote, allergy notice, table order submission, call waiter / request bill, order tracking.
- Staff: Live Orders Kanban with labelled polling, connection badge, unread counter, sound/notification opt-in, mute; KDS per station with readiness aggregation; waiter request handling.
- Casa de Marrocos created as tenant #1 with only the real details.

## Blockers / decisions needed from the owner
1. **Disk space:** the Mac has ~1.3 GB free (100 % full). The npm download cache (`~/.npm`, ≈3.3 GB) can be safely cleared — see README “Free disk space”.
2. **Owner email for Casa de Marrocos:** run `npm run setup:casa -- --owner-email=YOUR_EMAIL` to receive the owner invitation link.
3. Real business data still to be entered by the restaurant: postal code, opening hours, dishes, prices, allergens, tables, Google review link.

## Known limitations (M11)
- Loyalty expiry runs when the loyalty page, a member's order page or a redemption is opened (no background scheduler yet; M13 adds scheduled jobs).
- The loyalty card on the order page updates on reload, not on every status poll.
- Plan/module gating of loyalty and upsell is enforced in M12 (M12 module toggles, TEST 16).
## Next tasks (in order)
1. M12: analytics in the location time zone (order value / collected / cancelled / unpaid separate, TEST 18), CSV export, owner subscription page, plan limits, manual billing adapter, Super Admin metrics, module toggles (TEST 16).
2. M13: security audit, GDPR export/deletion, backups, monitoring, demo seed, deployment docs, full TEST 1–20, release.
