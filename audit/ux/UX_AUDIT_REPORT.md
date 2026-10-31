# Responsive & UX audit — 2026-10-31

Environment: isolated database `menuniva_test_ux` (fictitious data, `seed-ux.ts`), production build
served by `server.mjs`, Google Chrome via Playwright. 83 routes (every `page.tsx`, each as the right
role) × 8 widths (320, 375, 390, 430, 768, 1024, 1440, 1920); ≤1024 px emulated as touch devices.

## Results

| Measure | Before | After |
|---|---|---|
| Page views wider than the screen (phones/tablets, measured against the screen width) | 31 views on 18 routes | 0 |
| Distinct controls smaller than 24 px | 91 | 0 |
| Distinct controls under 40 px tall at 375 px | 178 | 14 (colour pickers, preview mock) |
| Console errors / failed requests (app) | 0 | 0 |
| Layout shift > 0.1 | 2 (Kitchen Display at 768) | 0 |

## Main defects found and fixed

- **Phones zoomed out on 18 pages** (dish editor 532 px wide, tax, preview, admin, home…). Root cause: grids without a mobile column template get an `auto` column that grows to the widest child. Fixed once in `globals.css` (`.grid { grid-template-columns: minmax(0,1fr) }`), plus wrapping for long button labels (`wrapButtonClass`). The old mobile test missed this because it compared with `innerWidth`, which grows when the page is zoomed out; it now compares with the screen width.
- **Live Orders columns overlapped** at 1024–1440 px (`min-w-[260px]` items in `grid-cols-5`). Now `auto-fit` columns that never overlap; phones get status tabs; cancelling asks for the reason in a dialog instead of `window.prompt`.
- **Guest table menu**: banner wrapping on 320 px phones covered the sticky category bar (fixed `top-[49px]`); offset now follows the measured banner height. Added scroll-spy chips, a visible close button and focus handling in dish/cart sheets, 40 px steppers, 16 px fields (no iOS zoom), contact chips, placeholder tiles for dishes without photos, dimmed totals while re-pricing.
- **Touch sizes**: buttons, inputs, selects and checkboxes grow on `pointer: coarse`; tiny text links ("Go", "Search", "Bill", "Edit", filters) became real controls.
- **Dashboard on phones**: bottom navigation by role, accessible drawer, skip link, two-per-row stats, readable menu rows, sticky save bar in the dish editor.
- **Dark mode**: `color-scheme` for native controls, lighter status colours, inverted dark badges.
- Promotions form shows only the fields of the chosen type; opening-hours editor explains inherited hours and can copy one day to all.

## Verification

`tsc` 0 errors · Vitest 61 files, 472 passed, 2 skipped (live Supabase bucket) · Playwright E2E 79 passed
(retries off) · demo suite 1 passed · UX journeys 10 passed · final crawl 664 views clean.
