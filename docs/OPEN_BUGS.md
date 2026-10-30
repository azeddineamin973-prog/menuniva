# MenuNiva — Open bugs, gaps and external blockers

Source of truth for everything **not** done. Fixed items move to `TODO.md` (FIX-xx) with the
regression test that proves them. Last updated 2026-10-30 (session 8, after the independent audit).

## Bugs from the audit — all fixed

| Audit ID | Severity | Status | Fix / test |
|---|---|---|---|
| BUG-01 concurrent orders failed (pool starvation) | Critical | FIXED | FIX-01 · `tests/integration/concurrency.test.ts` |
| BUG-02 sporadic E2E 404 (shared test DB) | High (harness) | FIXED | FIX-02 · advisory lock, lock test |
| BUG-03 split bills on simultaneous first orders | High | FIXED | FIX-03 · `concurrency.test.ts` |
| BUG-04 validation shown as "prices changed" | Medium | FIXED | FIX-04 · `takeaway-delivery.spec.ts` |
| BUG-05 Wi-Fi false positives / spoofable X-Forwarded-For | Medium | FIXED locally | FIX-07/08 · production proxy check is EXT-01 |
| BUG-06 oversized upload crash | Medium | FIXED | FIX-10 · `uploads.spec.ts` |
| BUG-07 promotion times in server time zone | Low | FIXED | FIX-11 · `promotion-timezones.test.ts` |
| BUG-08 valid coupon flashed "not valid" | Low | FIXED | FIX-12 · `checkout-recovery.spec.ts` |
| BUG-09 contact lost on reopening the cart | Low | FIXED | FIX-13 · `checkout-recovery.spec.ts` |
| BUG-10 misleading "reconnecting", no recovery | Low | FIXED | FIX-14 · `checkout-recovery.spec.ts` |
| BUG-11 discount kept after item reduction | Low | FIXED | FIX-09 · `discount-recalculation.test.ts` |
| BUG-12 shared build folder for E2E/demo | Low (harness) | FIXED | FIX-05 |

## Gaps from the audit

| Gap | Decision | Status |
|---|---|---|
| GAP-01 imported dishes reached no kitchen screen | Implementation | FIXED (FIX-06) |
| GAP-02 direct thermal printing | Needs real hardware to build and test | **OPEN — BLOCKED (hardware)**. Working alternative: browser print / PDF ticket per station |
| GAP-03 manager alerts in-app only | Needs an email/SMS provider | **OPEN — EXT-04/EXT-05** |
| GAP-04 takeaway/delivery 24/7 without hours | Implementation | FIXED (FIX-15) for enabling and publishing. Restaurants that already have takeaway on without hours see a red warning; their guests can still order at any hour until hours are entered |
| GAP-05 table limit race | Implementation | FIXED (FIX-16) |

## Remaining known limitations (not bugs, tracked)

| ID | Item | Status |
|---|---|---|
| LIM-01 | Guest cookie can be deleted; per-guest limits are a fairness tool, not identity | By design — per-IP (behind a proxy), per-table, per-phone and per-location ceilings remain |
| LIM-02 | With `TRUST_PROXY_HOPS=0` client IPs are unknown; per-IP login/sign-up limits do not apply (per-email and platform-wide ceilings do) | Configure per docs/DEPLOYMENT.md §2.1 |
| LIM-03 | An organization whose locations are in different time zones cannot create dated promotions (clear refusal) | Per-location promotion times would need a schema change |
| LIM-04 | Recomputed discounts after an item change only consider the promotions originally applied (never a different, better one) | By design: discounts only go down |
| LIM-05 | Owner/settings screens are English-only; staff operational screens and guest screens are localized | Known |
| LIM-06 | Live updates use polling (no push) | By design (MVP) |
| LIM-07 | The XLSX importer was tested with generated OOXML files, not with a file saved by Microsoft Excel | Test with the restaurant's own export before relying on it |

## External blockers (never mark done without a working, tested connection)

| ID | Item | Needs | Status |
|---|---|---|---|
| EXT-01 | Hosting, domain, TLS, managed EU PostgreSQL (PITR); verify `TRUST_PROXY_HOPS` | Owner decision + accounts | BLOCKED |
| EXT-02 | Scheduled, encrypted, off-site backups; monthly restore drill | Hosting | BLOCKED (commands work locally) |
| EXT-03 | Error monitoring endpoint | `ERROR_MONITORING_DSN` | NEEDS CONFIGURATION |
| EXT-04 | Email sending (invites, resets, alerts) | Provider + implementation | NOT IMPLEMENTED |
| EXT-05 | SMS / WhatsApp Business API | Provider + implementation | NOT IMPLEMENTED |
| EXT-06 | Direct thermal printing | Printer hardware | NOT IMPLEMENTED / BLOCKED |
| EXT-07 | Photo OCR | OCR engine | NEEDS CONFIGURATION |
| EXT-08 | Automatic translation | DeepL key or LibreTranslate | NEEDS CONFIGURATION (unverified code) |
| EXT-09 | Glovo / Uber Eats partner APIs | Partner approval | BLOCKED |
| EXT-10 | Online payments | Provider contract | BLOCKED |
| EXT-11 | Certified invoicing (PT AT / ES Verifactu) | Certified provider | BLOCKED |
| EXT-12 | SaaS billing processor | Processor account | NEEDS CONFIGURATION (manual billing works) |
| AUD-09 | Promotions for identified customers | Verified customer identity | FUTURE |

## Development database — records to review (nothing deleted)

| Tenant | Observation | Suggested action (needs your approval) |
|---|---|---|
| `casa-de-marrocos` "Casa de Marrocos" | Real tenant (bootstrap). **No member at all**; its only owner invitation was revoked on 2026-10-30 00:50 | Issue a new owner invitation (`npm run setup:casa -- --owner-email=…`) |
| `casa-de-maroccos` "casa de maroccos" | Self-registered 2026-10-30 11:05 by a `@palaciodoce.pt` account; looks like a misspelled duplicate of Casa de Marrocos; 1 table, 1 import job, no dishes | Confirm whether it is a test; archive or delete only with your approval |
| `huihugiy` "huihugiy" | Self-registered 2026-10-30 11:29 by a `@gmail.com` account; no data | Probably a test sign-up; archive/delete only with your approval |
| — | No Super Admin exists in the development database | Create one with `npm run setup:admin-token` when needed |
