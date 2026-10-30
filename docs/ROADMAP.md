# MenuNiva — Development Roadmap

**One Menu. Every Order. Every Language.**

Authoritative requirements: the MenuNiva Master Specification (Parts 1–32 plus the
"Additional final requirements": table & bill management, kitchen printing, production
reliability). This roadmap organises that specification into milestones. Nothing in the
specification is removed; anything not yet built is tracked in `TODO.md` and
`docs/FEATURE_MATRIX.md`.

Resume order for a new session: Master Specification → `TODO.md` → this file →
`docs/PROGRESS.md` → `docs/FEATURE_MATRIX.md`, then continue with the first unfinished task
whose dependencies are satisfied.

## Guiding rules

1. **Vertical slice first.** The first product goal: Casa de Marrocos creates a real menu,
   generates a table QR code, receives a genuine customer order, routes food to Kitchen and
   tea to Café, and completes the order. Optional features never delay this.
2. **SaaS from day one.** Every table row is tenant-scoped; Casa de Marrocos is tenant #1,
   never a hardcoded special case.
3. **Honest integrations.** Glovo, Uber Eats, translation, OCR, payments, SMS, invoicing,
   SaaS billing and printers are adapters with a truthful status
   (`NOT_CONFIGURED`, `LIMITED`, `CONNECTED`, `ERROR`). Nothing is labelled "Connected"
   without a working connection.
4. **No invented business data.** Dishes, prices, table counts, hours, allergens, Google
   links, delivery fees are entered by the restaurant.
5. **Done = verified.** A task is complete only when its acceptance criteria are verified
   by tests or a recorded manual check (see `QA_REPORT.md`).

## Technology (pinned, verified installed 2026-10-30)

| Layer | Choice |
|---|---|
| Web framework | Next.js 16.4.3 (App Router), React 19.3.1, TypeScript 5.9.3 |
| Styling | Tailwind CSS 4.3.3 with CSS-variable design tokens |
| Database | PostgreSQL 18 (local: `embedded-postgres`; production: managed PostgreSQL) |
| ORM | Prisma 7.10.1 with `@prisma/adapter-pg` |
| Validation | Zod 4.6.7 |
| Auth | Own server-side sessions (argon2id hashes, hashed session tokens in DB, httpOnly cookies) |
| QR / PDF | `qrcode` 1.5.4, `pdf-lib` 1.17.1 |
| Tests | Vitest 4.1.12 (unit + integration against real PostgreSQL), Playwright 1.64.1 (system Chrome) |
| Live updates | Clearly labelled polling (no WebSocket infrastructure in MVP) |

## Milestones and dependency order

```
M1 → M2 → M3 → M4 ─┬─→ M6 → M7 → M8 → M9 → M10 → M11 → M12 → M13
                   └─→ M5 (Import Studio, executed after M7)
```

M5 (Import Studio) depends only on M4. To honour the "vertical slice first" rule, it is
executed **after M7**. M6/M7 do not depend on M5 (menus can be created manually).

| # | Milestone | Objective | Depends on | Acceptance criteria (milestone gate) |
|---|---|---|---|---|
| M1 | Project setup, architecture, branding & design system | Working Next.js + PostgreSQL project, design tokens, logo, dashboard shell, i18n foundation, test harness | — | Typecheck + build pass; app renders in light/dark; 5 locales load; Arabic renders RTL; tests run against real PostgreSQL |
| M2 | Database, authentication, multi-tenancy & Super Admin | Full schema, secure auth, roles, tenant isolation, audited Super Admin bootstrapped securely | M1 | Sign-up/login/logout work; protected routes check membership + role server-side; isolation tests pass (TEST 1, 15 base); Super Admin created via one-time token; admin actions audited |
| M3 | Restaurant onboarding, settings & staff roles | Owner can register a restaurant and complete a 10-step wizard; staff invitations; Casa de Marrocos tenant | M2 | Wizard saves drafts and shows progress; invite → accept → role-limited access; Casa de Marrocos exists with service zones and stations but no invented dishes |
| M4 | Menu management, five languages & translation system | Full menu model, channel prices, allergens with verification, translations with honest provider abstraction | M3 | CRUD for categories/products/variants/modifiers; prices in integer cents; unverified allergens never published; missing translations show "Translation required"; review-before-publish |
| M5 | Magic Import Studio | CSV/XLSX/PDF/image/text/Glovo/Uber import with preview, duplicates, review, publish, rollback | M4 | CSV import → review → publish → visible on menu (TEST 2); failed imports publish nothing (TEST 19); adapters report truthful status; SSRF tests pass |
| M6 | QR codes, tables, customer menu & cart | Areas/tables, secure QR tokens, printable sheets, mobile menu in 5 languages, cart, server quote | M4 | QR opens correct location/table; language switch incl. RTL (TEST 3); server rejects tampered prices |
| M7 | Direct ordering, live dashboard, kitchen & café | Reliable order submission, state machine, Kanban dashboard, alerts, KDS with station routing | M6 | TEST 4, 5, 6, 7, 17 pass end-to-end; order exists in DB before UI confirms |
| M8 | Table sessions, bills, waiter requests & kitchen printing | Session merge/transfer, item void with audit, split bills, partial payments, call-waiter/bill tasks, printable tickets | M7 | Partial payments never mark unpaid items paid; transfers audited; printable kitchen & café tickets |
| M9 | Takeaway, delivery zones, staff delivery & WhatsApp | Pickup slots, PT/ES postal-code zones, delivery workflow, driver view, WhatsApp & external links | M7 | TEST 8, 9, 10 pass; no claims of courier dispatch or GPS |
| M10 | Promotions, coupons & reservations | Server-side promotion engine; reservation requests with honest availability; no double-booking | M7 | TEST 11, 12 pass; totals never negative; no double discounts |
| M11 | Smart Reviews, complaint recovery, loyalty & upsell | Private feedback + equal Google link; complaint workflow; voluntary loyalty; deterministic upsell | M7 | TEST 13, 14 pass; no review gating; upsell never auto-adds |
| M12 | Analytics, subscriptions, plans & SaaS administration | Real analytics with paid vs unpaid separation; plans/limits; manual billing; admin metrics | M7–M11 | TEST 16, 18 pass; CSV export; no fake charts |
| M13 | Security, testing, backups, deployment & release | Security review, GDPR flows, health checks, monitoring, backups, environments, full E2E | all | TEST 1–20 pass; QA_REPORT complete; deployment guide and launch checklist written |

## External dependencies that can block "production-ready"

| Item | Why blocked | Working alternative in MenuNiva |
|---|---|---|
| Glovo partner API | Requires Glovo partner approval + credentials | Merchant exports, CSV/XLSX, pasted text |
| Uber Eats Menu API | Requires Uber partner approval + OAuth credentials | Same as above |
| Machine translation | Requires DeepL key or a LibreTranslate server | Manual translation editor; "Translation required" status |
| OCR for photos | Requires a configured OCR engine | PDF native text extraction; paste text; manual entry |
| Online payments (MB WAY, Multibanco, cards, Bizum) | Requires provider contract, credentials, compliance | Pay at counter / waiter / cash on delivery + manual payment recording |
| Certified invoicing (PT: AT-certified software; ES: Verifactu/TicketBAI) | Requires certified provider integration | Internal receipt clearly labelled "not an invoice"; invoicing adapter interface |
| SaaS billing automation | Requires billing processor account | Manual subscription management by Super Admin |
| Email/SMS | Requires SMTP / SMS provider | Links shown on screen; no SMS sent |
| Thermal printers | Requires testing with real hardware | Browser print / PDF tickets |
