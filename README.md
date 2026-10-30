# MenuNiva

**One Menu. Every Order. Every Language.**

Multi-tenant restaurant platform: QR table ordering, live orders, kitchen & café displays,
five-language menus (pt-PT, en, fr, ar, es — Arabic right-to-left), menu import, bills and split
payments, takeaway, own delivery, WhatsApp orders, promotions, reservations, private feedback with an
equal Google review link, loyalty, cart suggestions, analytics, plans and Super Admin.
Casa de Marrocos (Braga) is tenant #1.

Project tracking: [`TODO.md`](TODO.md) · [`docs/ROADMAP.md`](docs/ROADMAP.md) · [`docs/PROGRESS.md`](docs/PROGRESS.md) ·
[`docs/FEATURE_MATRIX.md`](docs/FEATURE_MATRIX.md) · [`QA_REPORT.md`](QA_REPORT.md) · [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) ·
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) (going live, backups, launch checklist)

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
npm run test:e2e    # browser tests (builds the app, uses Google Chrome) — run after npm test, never at the same time
npm run test:demo   # TEST 20: full flow in the separate demo environment
npm run typecheck
```
Tests never touch your real restaurant data (they use `menuniva_test` and `menuniva_demo`).

### Demo restaurants (fictitious, separate database)
```bash
npm run demo:seed   # (re)creates "Restaurante Demo" and "Casa de Marrocos (DEMO)" in menuniva_demo and prints the logins
```
The Casa de Marrocos demo uses the real layout (rooms, downstairs kitchen, café, reception counter) with fictitious dishes and prices marked "(demo)". It is not the real menu.
To open it, start the app against the demo database:
`APP_ENV=demo DATABASE_URL=$DEMO_DATABASE_URL npm run dev` (every page then shows a DEMO banner).

### Everyday operations
```bash
npm run backup          # backup of the database in ./backups (contains personal data — keep it safe)
npm run db:migrate:safe # after updating MenuNiva: status → backup → migrate → verify
npm run retention       # erase old guest contact data per each restaurant's retention period (run daily)
```

### Free disk space (recommended)
Your Mac is almost full (~1 GB free). The npm download cache is safe to delete and is re-downloaded only if needed:
```bash
npm cache clean --force
```
This frees about 3 GB. Nothing in MenuNiva or your other projects is affected.

---

## What works today and what does not
See [`docs/FEATURE_MATRIX.md`](docs/FEATURE_MATRIX.md) for the full status of every feature. In short:

- **Working & tested:** everything in the master specification that does not depend on an outside company
  (see the matrix), including GDPR export/erasure, backups/restore, safe migrations and an automated
  authorization audit of every page, route and action.
- **Needs configuration / external approval:** machine translation (DeepL or LibreTranslate), email (SMTP),
  Glovo/Uber Eats partner APIs, online customer payments, certified invoicing, a SaaS billing processor,
  photo text recognition (OCR) for menu photos, thermal printers (formatter ready, untested on hardware).
- **Your restaurant data:** Casa de Marrocos still needs its real postal code, hours, dishes, prices,
  allergens, tables and Google review link before it is published.

Payments are taken at the restaurant. MenuNiva receipts are **not** legal invoices.

## Configuration
Copy `.env.example` to `.env` (already done on this Mac with random local passwords). Never commit `.env`.
