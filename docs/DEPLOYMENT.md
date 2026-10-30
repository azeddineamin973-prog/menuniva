# MenuNiva — Deployment, Operations & Launch Guide

This guide covers running MenuNiva outside this Mac: environments, first deployment, updates with
safe migrations, backups and restore, data retention, monitoring, and the launch checklist.
Nothing here has been deployed yet: no hosting provider, domain or production database exists today.

## 1. Environments

Each environment has its **own database** and its own `.env`. The app refuses to start when the
combination is dangerous (`src/server/env.ts → environmentProblems`, tested in `tests/unit/environments.test.ts`).

| `APP_ENV` | Purpose | Database (name must…) | URL | Data |
|---|---|---|---|---|
| `development` | this Mac (`npm run dev`) | `menuniva_dev` (not `*test*`) | http://localhost:3000 | Casa de Marrocos (real details only) |
| `test` | automated tests | `menuniva_test` (wiped by every test run) | http://localhost:3100 | fictitious, temporary |
| `demo` | sales demos | contains `demo`, e.g. `menuniva_demo` | any; https if public | fictitious only (`npm run demo:seed`), DEMO banner on every page |
| `staging` | rehearsal of each release | not dev/test/demo, e.g. `menuniva_staging` | **https required** | copy of production restored from a backup, or fictitious |
| `production` | real restaurants | not dev/test/demo/staging, e.g. `menuniva_prod` | **https required** | real |

Rules enforced at start-up:
- production/staging: `APP_BASE_URL` must be https; database name must not contain dev/test/demo (production also not staging);
- demo: database name must contain `demo`;
- any non-test environment: never the test database;
- production/staging/demo: `APP_SECRET` must not be the example value.
Session cookies are `Secure` whenever `APP_BASE_URL` is https.

### Required configuration (production)
| Variable | Value |
|---|---|
| `APP_ENV` | `production` |
| `APP_BASE_URL` | e.g. `https://app.menuniva.example` (used in QR codes — choose it before printing QR codes) |
| `DATABASE_URL` | managed PostgreSQL ≥ 16, TLS (`?sslmode=require`), dedicated user |
| `APP_SECRET` | 32+ random bytes: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`. Changing it invalidates order-tracking links. |
| `UPLOAD_DIR` | persistent disk path for logos/photos (back it up too) |
| Optional | `SMTP_URL`, `EMAIL_FROM`, `TRANSLATION_PROVIDER` + key, `ERROR_MONITORING_DSN`, `BACKUP_DIR`, `BACKUP_KEEP` |

## 2. Hosting requirements
- Node.js ≥ 20.9 (Next 16 requirement; developed and tested on Node 24) on a Linux server/VM or container; one or more app instances
  behind an https reverse proxy (Caddy, nginx, a platform load balancer). The proxy must pass `X-Forwarded-For`
  and `Host`; rate limits use the client IP.
- Managed PostgreSQL in an EU region (guest personal data; GDPR), automated daily backups + point-in-time recovery.
- Persistent storage for `UPLOAD_DIR` (or a single instance with a mounted volume). Several instances need a shared volume.
- Live updates use polling (no WebSockets), so any standard proxy works.
- Rate limits are stored in PostgreSQL, so several instances share them.

## 3. First deployment
```bash
git clone <repo> menuniva && cd menuniva
npm ci                                   # also runs prisma generate
cp .env.example .env && edit .env        # production values (section 1)
npx prisma migrate deploy                # creates the schema in the empty production database
npm run build
npm run start                            # or a process manager: systemd / pm2 / container CMD
curl https://<your-domain>/api/health    # {"status":"ok","database":"ok",…}
npm run setup:admin-token                # one-time Super Admin link (valid 60 minutes)
```
Then in Super Admin → Platform settings: support email, trial length, whether self-registration is open.

## 4. Updating MenuNiva (safe migrations)
1. Read the release notes in `QA_REPORT.md` / git log. Run the release on **staging** first (restore a recent production backup there).
2. Deploy the new code (`git pull && npm ci && npm run build`), keep the old version running.
3. `npm run db:migrate:safe` — shows pending migrations, **takes a backup**, runs `prisma migrate deploy`, verifies all migrations finished.
4. Restart the app; check `/api/health` and log in.

Never run `prisma migrate dev`, `prisma migrate reset` or `prisma db push` outside development: they can drop data.
Migration rules (checked by `tests/unit/migrations.test.ts`): no destructive SQL (DROP/RENAME/TRUNCATE/DELETE/type change/SET NOT NULL)
unless the migration contains `-- menuniva: reviewed-destructive <reason>`; new NOT NULL columns need a default; applied migrations are never edited.
Destructive changes are done in two releases: add the new column → backfill → switch the code → later remove the old column.

### If a migration fails
- The app keeps running on the old code; nothing is restarted.
- Read the error printed by `db:migrate:safe`. Fix the cause (e.g. data that violates a new constraint), then
  `npx prisma migrate resolve --rolled-back <migration_name>` and run `npm run db:migrate:safe` again.
- If data was damaged: restore the pre-migration backup into a new database (section 5) and switch `DATABASE_URL` to it.

## 5. Backups and restore
Strategy (both layers):
1. **Provider backups** — enable the managed database's daily snapshots with ≥ 14 days retention and point-in-time recovery. This is the primary protection.
2. **MenuNiva logical backups** — `npm run backup` (cron, e.g. hourly or nightly), independent of the provider:
   ```
   0 2 * * *  cd /srv/menuniva && npm run backup -- --dir=/secure/backups --keep=30 >> /var/log/menuniva-backup.log 2>&1
   ```
   Writes `<db>-<timestamp>.ndjson.gz` + `.sha256` (file mode 600) from one consistent snapshot. Copy them to encrypted storage
   in another location (e.g. object storage with server-side encryption). **Backups contain guest personal data.** Also back up `UPLOAD_DIR`.

Restore (tested in `tests/integration/backup-restore.test.ts`: exact row-for-row copy, damaged files refused):
```bash
createdb menuniva_restore                                  # or create it in the provider console
DATABASE_URL=postgres://…/menuniva_restore npx prisma migrate deploy    # same migrations as the backup
npm run restore -- --file=/secure/backups/menuniva_prod-….ndjson.gz --url=postgres://…/menuniva_restore --yes
```
The restore refuses non-empty targets, schema mismatches and checksum mismatches, inserts in foreign-key order in one
transaction and verifies every table's row count before committing. Check the restored database, then point `DATABASE_URL` at it.
**Restore drill:** once a month restore the latest backup into staging and log in.

## 6. Data retention and GDPR
- Each restaurant sets its retention period in **Settings → Privacy (GDPR)** (default 730 days).
- Run daily: `15 3 * * *  cd /srv/menuniva && npm run retention`. It erases guest names, phones, addresses and notes of
  finished orders and past reservations older than the period, follow-up contacts in feedback, and loyalty members with no
  activity in the period; and removes expired sessions, tokens, invitations, rate-limit buckets and error logs older than 90 days.
  Order amounts and dish lines are kept for accounting.
- Guest requests: Settings → Privacy → search by phone or email → **Download data (JSON)** or **Erase personal data** (type ERASE).
  The audit log stores only a hash of the identifier and counts.
- The operator (MenuNiva) is the processor; each restaurant is the controller of its guests' data. A data processing
  agreement and privacy notice must be prepared with a lawyer before launch (not provided by this software).

## 7. Monitoring
- `GET /api/health` — app + database (use for uptime monitoring and load-balancer checks).
- Server errors (pages, actions, route handlers) are stored in **ErrorLog** (Super Admin → Integrations & errors), with
  personal data scrubbed and private tokens masked. With `ERROR_MONITORING_DSN=https://…` each error is also POSTed as JSON
  to that endpoint (a webhook-style collector). Sentry's own protocol is **not** implemented.
- Watch Super Admin metrics: errors (7 days), past-due subscriptions, open support issues.

## 8. Security notes
- Every page, route and server action is covered by an authorization audit (`tests/unit/route-audit.test.ts` static,
  `tests/e2e/route-audit.spec.ts` runtime: anonymous, another restaurant's owner, a waiter).
- Passwords: argon2id; sessions: random token, SHA-256 stored, httpOnly + SameSite cookies; login: 30 failed attempts per IP and
  8 per email per 15 minutes (successful logins never count).
- CSRF: origin check on every mutating route; server actions have Next.js' built-in origin check.
- Security headers in `next.config.ts` (nosniff, frame, referrer, permissions). Add HSTS at the https proxy.
- Keep `.env`, backups and `UPLOAD_DIR` readable only by the app user.

## 9. Launch checklist
Infrastructure
- [ ] Domain + https certificate; `APP_BASE_URL` final (QR codes depend on it)
- [ ] Managed PostgreSQL (EU), TLS, provider backups + PITR enabled
- [ ] `npm run backup` cron + off-site encrypted copy; first restore drill done on staging
- [ ] `npm run retention` daily cron
- [ ] Uptime check on `/api/health`; `ERROR_MONITORING_DSN` set (optional)
- [ ] `UPLOAD_DIR` on persistent, backed-up storage
- [ ] Staging environment with the same configuration
Application
- [ ] `npm test`, `npm run test:e2e`, `npm run test:demo` green on the release commit
- [ ] Super Admin created with a strong password; setup token used
- [ ] Platform settings: support email, trial length, self-registration on/off
- [ ] Plans and prices reviewed (default prices are placeholders, not commercial pricing)
- [ ] SMTP configured, or accept that invitations/reset links are shared manually
Legal / business (outside the software)
- [ ] Privacy notice and terms for guests and restaurants; data processing agreement
- [ ] Restaurants informed: MenuNiva receipts are not certified invoices; online payments are not offered
- [ ] Allergen information entered and verified by each restaurant
Casa de Marrocos (tenant #1)
- [ ] Owner account (`npm run setup:casa -- --owner-email=…`)
- [ ] Real postal code, opening hours, dishes, prices, allergens, tables, official Google review link
- [ ] Print QR codes only after the final domain is set; test one table end to end; publish
