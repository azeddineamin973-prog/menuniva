# MenuNiva

**One Menu. Every Order. Every Language.**

Multi-tenant restaurant platform: QR table ordering, live orders, kitchen & café displays,
five-language menus (pt-PT, en, fr, ar, es), with takeaway, delivery, reservations, reviews,
loyalty and analytics following in later milestones. Casa de Marrocos (Braga) is tenant #1.

Project tracking: [`TODO.md`](TODO.md) · [`docs/ROADMAP.md`](docs/ROADMAP.md) · [`docs/PROGRESS.md`](docs/PROGRESS.md) ·
[`docs/FEATURE_MATRIX.md`](docs/FEATURE_MATRIX.md) · [`QA_REPORT.md`](QA_REPORT.md) · [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

---

## Start MenuNiva on this Mac (step by step)

You need two Terminal windows. In Kiro: **Terminal → New Terminal** (twice).

**Terminal 1 — database** (leave it open):
```bash
cd ~/Desktop/saas/menuniva
npm run db:local
```
Wait for: `MenuNiva local PostgreSQL is running on 127.0.0.1:5433`.

**Terminal 2 — app** (leave it open):
```bash
cd ~/Desktop/saas/menuniva
npm run dev
```
Open **http://localhost:3000** in Chrome.

### First time only

1. **Create your Super Admin account** (in a third terminal, or stop/restart nothing):
   ```bash
   cd ~/Desktop/saas/menuniva
   npm run setup:admin-token
   ```
   Open the printed link within 60 minutes and fill in your name, email and a password (10+ characters).
   The link works once. There is no default password.

2. **Become the owner of Casa de Marrocos** (use your real email):
   ```bash
   npm run setup:casa -- --owner-email=YOUR_EMAIL
   ```
   - If you already have a MenuNiva account with that email, you are added as owner immediately.
   - Otherwise open the printed invitation link, click **Create account** with the same email, then **Accept invitation**.

3. In the dashboard click **Continue setup →** and follow the 10 steps: postal code & opening hours,
   logo, dishes and prices, translations, tables & QR codes, ordering channels, kitchen stations, preview, publish.

### Run the tests
```bash
npm test            # unit + integration tests on the separate test database
npm run test:e2e    # full browser test (builds the app, uses Google Chrome)
npm run typecheck
```
Tests never touch your real restaurant data (they use `menuniva_test`).

### Free disk space (recommended)
Your Mac is almost full (~1 GB free). The npm download cache is safe to delete and is re-downloaded only if needed:
```bash
npm cache clean --force
```
This frees about 3 GB. Nothing in MenuNiva or your other projects is affected.

---

## What works today and what does not
See [`docs/FEATURE_MATRIX.md`](docs/FEATURE_MATRIX.md) for the full status of every feature. In short:

- **Working & tested:** accounts, restaurant tenants and isolation, roles, Super Admin bootstrap, setup wizard,
  menu with per-channel prices, variants/extras, verified allergens, translations, tables & QR codes,
  five-language mobile menu (Arabic RTL), table ordering, live orders, kitchen/café displays, call waiter / bill requests.
- **Not built yet:** menu import, takeaway, delivery, promotions, reservations, reviews, loyalty, upsell,
  analytics, payment recording/split bills, kitchen ticket printing, demo environment, deployment.
- **Needs external accounts:** machine translation (DeepL or LibreTranslate), email (SMTP), Glovo/Uber Eats partner APIs,
  online payments, certified invoicing, automated SaaS billing.

Payments are taken at the restaurant. MenuNiva receipts are **not** legal invoices.

## Configuration
Copy `.env.example` to `.env` (already done on this Mac with random local passwords). Never commit `.env`.
