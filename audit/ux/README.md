# Responsive / UX audit tooling (2026-10-31)

Everything here runs against an **isolated** database, `menuniva_test_ux`, filled with fictitious
data by `seed-ux.ts`. It never touches `menuniva_dev` (real restaurants), `menuniva_test`
(E2E suite) or `menuniva_demo`. Screenshots and JSON results go to `audit/artifacts/ux/`
(git-ignored).

| File | Purpose |
|---|---|
| `seed-ux.ts` | Wipes and fills `menuniva_test_ux`: a busy restaurant (photos, long names, variants, allergens, orders in every state, bills, reservations, promotions, reviews, loyalty, staff tasks, an import in review), a restaurant still in onboarding, a Super Admin and one login per role. Prints logins/tokens as JSON. |
| `server.mjs` | Builds into `.next-ux` and serves on port 3300 with `APP_ENV=test`, local storage and no outbound network (fixture manifest + local stand-in AI model). |
| `ids.mjs` | Looks up an open table session and a kitchen ticket for the crawler. |
| `crawl.mjs` | Visits all 83 routes (every `page.tsx`, as the right role) at 320/375/390/430/768/1024/1440/1920 px; phones and tablets are emulated as touch devices. Records page width against the **screen** width (catches pages that make a phone zoom out), controls under 24 px and under 40 px, clipped button text, broken/distorted images, unlabeled fields, layout shift, console errors and failed requests; takes full-page screenshots. |
| `summarize.mjs` | Prints a section of a crawl (`status`, `overflow`, `errors`, `tap`, `tap40`, `clip`, `img`, `cls`, `labels`, `slow`, `tiny`). |
| `sheet.py`, `grid.py` | Build review sheets from screenshots. |
| `journeys.spec.ts` + `playwright.ux.config.ts` | Real user journeys at phone/tablet/desktop sizes (guest table order, takeaway, delivery, reservation, feedback; owner, waiter, kitchen). Fail on any console error or failed request. |

```bash
UX_DATABASE_URL=postgresql://…/menuniva_test_ux npx tsx --conditions=react-server audit/ux/seed-ux.ts > audit/ux/out/seed.json
node audit/ux/ids.mjs
node audit/ux/server.mjs 3300            # separate terminal; --no-build to reuse the build
node audit/ux/crawl.mjs --run after      # --widths 375,1440  --only /dashboard  --no-shots  --dark
node audit/ux/summarize.mjs after overflow
npx playwright test --config audit/ux/playwright.ux.config.ts
```

Findings and fixes: `UX_AUDIT_REPORT.md`.
