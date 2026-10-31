# Importing a menu from Glovo

Paste your Glovo store link and the menu is read from your public store page.

## For the restaurant owner

1. Dashboard → **Import Studio**.
2. Paste the address of your Glovo store page, e.g.
   `https://glovoapp.com/pt/pt/braga/stores/casa-de-marrocos-brg`, and press **Import Menu**.
3. The review screen opens with totals, photo thumbnails and a searchable table
   (category filter, status filter, 25/50/100 rows per page).
4. Fix anything with **Edit**, or select several products to **Import**, **Skip** or **Move** them
   to another category at once.
5. **Save to menu**: pick one station for all categories (or per category), tick the photo-rights
   box if you may use the photos, and press **Save N products as drafts**.

CSV, Excel, PDF, pasted text, Uber Eats exports and the Glovo browser capture are under
**Advanced import options**. A link or file that yields no products creates no import at all.

### Photos

Preview thumbnails load straight from Glovo's image CDN (`?width=160`) in the owner's browser;
nothing is copied while reviewing. Photos are copied into MenuNiva storage (Supabase in
production) only when the owner ticks the rights box at save time, at `?width=1000`, six at a
time. A placeholder appears only when a product has no photo address or the photo fails to load.

Root cause of the earlier "no photos in the preview": the review table printed the text
"Photo found" and never rendered an image. The stored URLs, the CDN and the media route were
working; no Content-Security-Policy blocks images.

What arrives: sections, dish names, descriptions, Glovo prices, photos, sizes, extras with
their selection limits, and sold-out state.

**Get the link right.** Glovo store slugs usually end with a city suffix, e.g. `-brg` for
Braga. An address without it is a different page and Glovo answers it with a styled
"page doesn't exist" screen — served as HTTP 200, not a 404. MenuNiva detects that and says so
by name instead of reporting an empty menu. Open your restaurant on Glovo and copy the address
from the browser rather than typing it.

Measured on live pages (2026-10-31):

| Store | Time | Items | Sections | Photos | Sizes | Extras |
|---|---|---|---|---|---|---|
| `casa-de-marrocos-brg` | 0.8 s | 73 | 14 | 73 | 0 | 0 |
| `braga-pizzaria-kebab-brg` | 0.8 s | 48 | 8 | 48 | 0 | 31 |
| `mcdonald-s-brg` | 1.1 s | 116 | 12 | 116 | 29 | 100 |

Sizes and extras only appear when the restaurant configured them on Glovo. A store with none
imports zero of them; that is the store's menu, not a failure.

## How it works, and the limits we put on it

A Glovo store page is server-rendered. The HTML returned to an ordinary HTTPS client already
contains the whole catalogue inside the React streaming payload: sections, dishes, descriptions,
`priceInfo`, `imageId` photo references and the full `attributeGroups` tree with `min`/`max`
selection limits. No browser, no session and no credential is involved.

Requests identify MenuNiva honestly — `MenuNiva-Import/1.0 (+https://menuniva.com/import-bot…)`
— and `safeFetch` refuses any caller trying to pass a User-Agent that does not start with
`MenuNiva`. Glovo serves the same full page to that User-Agent as to a browser, so there is no
reason to disguise the request.

Because this reads someone else's site, the behaviour is deliberately narrow:

- only `glovoapp.com`, only https, only the exact page the owner pasted;
- one page per import, fetched when a signed-in owner asks — no crawler, no link following,
  no background refresh;
- rate limited to 12 reads per hour per restaurant;
- the `Disallow` paths in Glovo's robots.txt are refused before any request is made
  (store pages are not disallowed; `robots.txt` allows `/`);
- SSRF-guarded fetch, 12 MB cap, 25 s timeout, at most 3 redirects, each re-validated;
- failures are reported plainly and extract nothing — never an invented menu.

A **Glovo partner API** connection is still the sanctioned route for an ongoing, supported
integration and needs Glovo's approval (`TODO.md` → EXT-09). The adapter therefore reports
`LIMITED`, never `CONNECTED`, and the extraction method is recorded as `PUBLIC_PAGE` rather
than `PARTNER_API`, so no report can imply an integration that does not exist.

### A note on the earlier conclusion

An earlier version of this feature concluded that store pages serve no menu to a server. That
was wrong: the page tested was a mistyped slug, so the measurement was taken on Glovo's
"page doesn't exist" screen — which is also why it carried `noindex, nofollow`. Real store pages
carry no such directive and do serve the full menu. The browser-capture fallback below is what
remains of that approach.

## Fallback: capture in your own browser

Kept for the cases the link cannot cover — a store page that is not public, or a future Glovo
change. It runs in the owner's browser, reads only the already-loaded page, and sends nothing
anywhere: `src/lib/glovo-capture.ts`. The steps are in the collapsed
"Did not work?" panel in Import Studio. Your **Glovo menu export** (CSV/Excel) from the partner
portal also works in the same place.

## Guarantees the import keeps

- **Nothing reaches the menu before Publish.** Extraction writes only to `ImportedProduct`.
- **Glovo prices never become your prices.** They are stored as
  `ExternalSourcePrice(provider: GLOVO)`. `ChannelPrice(DINE_IN)` is only ever set from a
  source the restaurant owns (CSV/Excel/PDF/text).
- **Imported dishes are drafts.** Because a platform source sets no in-house price, every dish
  imported from Glovo is created as `DRAFT` even when "make visible" is ticked. It becomes
  orderable once the owner prices it.
- **Existing dishes are never overwritten.** An item resembling a dish already on the menu
  defaults to `SKIP`; linking it only adds a reference price.
- **Platform surcharges are not charged as yours.** A size or extra read from Glovo is created
  with a `priceDeltaCents` of 0.
- **Sold out stays sold out.** `soldOut` on the dish, until staff change it.
- **Photos only with confirmed rights.** Nothing is copied unless the owner ticks the rights
  box. Each file is then fetched through the SSRF-guarded client, size-capped, identified by its
  magic bytes (SVG refused), and stored under the tenant's own `<organizationId>/products/`
  prefix in Supabase Storage, served by the app at `/media/<key>` — never hot-linked to Glovo.
- **Allergens are never imported as verified.**

## Where the code lives

| Piece | File |
|---|---|
| Store-link parsing, payload parsing, sizes/extras split, photo URLs | `src/server/import/glovo.ts` |
| Reading the store page, robots/rate/error rules | `src/server/import/glovo-fetch.ts` |
| Browser-capture fallback snippet | `src/lib/glovo-capture.ts` |
| Adapter registration and honest status | `src/server/import/adapters.ts` |
| Persisting extras, publish rules, inline edits, photo copying | `src/server/import/service.ts` |
| Link panel, editable review row | `src/app/dashboard/[org]/import/[jobId]/` |

## Tests

| Scope | File |
|---|---|
| Parser: links, payload shapes, sizes vs extras, sold-out, dedupe, bad input | `tests/unit/glovo-parser.test.ts` |
| Reading a store page: full extraction, soft-404, refusals, outages, rate limit | `tests/integration/glovo-url-import.test.ts` |
| Capture → review → edit → publish, tenant isolation, photo storage | `tests/integration/glovo-import.test.ts` |
| Owner's journey in a browser | `tests/e2e/glovo-import.spec.ts` |
| The fallback snippet reads a rendered page and its output imports | `tests/e2e/glovo-capture-snippet.spec.ts` |

Every test runs against the `menuniva_test` database with fictitious "Test …" restaurants, and
**none of them touches the network**: store pages come from `tests/support/glovo-page.ts`, which
reproduces the real payload structure, through an injected fetcher. `resetDatabase` refuses to
run against any database whose name is not `menuniva_test`.

## If an import finds nothing

The parser recognises dishes by their fields rather than by one fixed Glovo layout, so it
survives most changes on Glovo's side. If a redesign defeats it, the import fails with an
explanation and extracts nothing. Check the link first (the `-brg`-style suffix), then fall back
to the browser capture or the merchant export, and widen the key lists at the top of
`src/server/import/glovo.ts`.
