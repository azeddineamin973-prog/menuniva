# MenuNiva — Architecture

One Next.js application (App Router) + one PostgreSQL database. No microservices.

```
Browser (guest phone / staff tablet / owner laptop)
   │  HTTPS, httpOnly session cookie (staff only)
   ▼
Next.js 16 (src/app)
   ├─ Server Components: pages render tenant-scoped data
   ├─ Server Actions:   dashboard forms  ──► src/server/action.ts (auth + permission + errors)
   ├─ Route Handlers:   JSON APIs        ──► src/server/route-tenant.ts (origin check + auth)
   │                    public APIs      ──► origin check + rate limit + Zod
   ▼
src/server/services/*  (business logic, always receives an authorised TenantContext)
   ▼
Prisma 7 + @prisma/adapter-pg  ──►  PostgreSQL 18
```

## Folders
| Path | Contents |
|---|---|
| `prisma/schema.prisma` | Complete data model (all milestones) |
| `src/app/(auth)` | sign up, login, password reset |
| `src/app/dashboard/[org]` | restaurant dashboard (role-filtered) |
| `src/app/admin` | Super Admin |
| `src/app/r/[org]` | public storefront (SEO) |
| `src/app/t/[token]` | table QR entry |
| `src/app/o/[token]` | private order tracking |
| `src/app/api/public/*` | guest APIs (quote, orders, table requests, tracking) |
| `src/app/api/dashboard/[org]/*` | staff JSON APIs (live orders, KDS, tasks, QR images/PDF) |
| `src/server` | env, db, auth, tenancy, audit, rate limiting, storage, services |
| `src/lib` | browser-safe helpers: money, postal codes, permissions, order state machine, time zones |
| `src/i18n` | five dictionaries (pt-PT, en, fr, ar, es) |

## Multi-tenancy
- Hierarchy: Platform → `RestaurantOrganization` → `RestaurantLocation` → staff (`RestaurantMembership`), menus, tables, orders.
- Every tenant row stores `organizationId`. Services only receive a `TenantContext` built by `resolveTenantAccess()` (user + ACTIVE membership + role permission checked in the database), and filter every query by `ctx.org.id`.
- IDs from the browser are re-checked (`assertLocationAccess`, `assertProduct`, …). A wrong-tenant ID behaves like “not found”.
- Staff may be limited to some locations (`locationIds`).
- Super Admins have **no implicit access** to tenant data (privacy); they manage tenants through `/admin` only.

## Authentication & security
- Passwords: argon2id. Sessions: 256-bit random token in an httpOnly, SameSite=Lax (Secure in production) cookie; only its SHA-256 is stored.
- CSRF: Server Actions use Next.js origin checks; route handlers call `assertSameOrigin`.
- Rate limiting: fixed windows in PostgreSQL (`RateLimitBucket`) — works across instances.
- First Super Admin: CLI generates a 60-minute single-use token; consumed atomically.
- Uploads: magic-byte sniffing (PNG/JPEG/WebP only, no SVG), size limit, random names, served with `nosniff`.
- Audit log for staff/admin mutations; error log for unexpected exceptions.

## Money
Integer euro cents everywhere (`*Cents`). Parsing rejects ambiguous inputs. Order lines store immutable snapshots of names, unit prices and modifiers. Imported platform prices live in `ExternalSourcePrice` and never touch in-house prices.

## Orders
- Pricing: `quoteCart()` recomputes from the DB (channel price → location override, variant delta, modifier rules, availability, sold-out).
- Submission: one transaction; per-location order number via atomic increment; unique `(locationId, idempotencyKey)`; tracking token = HMAC(APP_SECRET, location + key) so retries return the same token; only its hash is stored.
- State machine: `src/lib/order-state.ts`. Updates use optimistic concurrency (`expectedFrom`) so replays cannot double-apply.
- Kitchen: tickets per station are created on acceptance; order becomes PREPARING when any station starts and READY only when all stations are ready.
- Live updates: **polling** (5 s dashboard, 4 s KDS, 6 s guest), labelled in the UI, with reconnection and connection badge.

## Translations
Rows per language with status SOURCE / MACHINE / REVIEWED. Guests see SOURCE/REVIEWED; MACHINE text stays hidden until a person approves it. Provider abstraction: none (default) / DeepL / LibreTranslate. Ingredients and allergens are never machine-translated.

## Environments
`menuniva_dev` (real tenants such as Casa de Marrocos), `menuniva_test` (wiped by automated tests), `menuniva_demo` (clearly labelled fake data, M13). Production: managed PostgreSQL + `prisma migrate deploy`.
