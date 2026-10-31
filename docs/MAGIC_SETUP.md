# Magic Restaurant Setup

One screen that finds a restaurant and fills in its details, instead of typing them into the
first steps of the wizard.

## For the restaurant owner

Dashboard → **Set up your restaurant**. Give whatever you already have:

| You give | What it is used for |
|---|---|
| **Google Maps link** | Share → Copy link in Google Maps. Gives your name and exact location. |
| **Your website** | The best source. Usually has your address, phone, email, hours and social links. |
| **Name and city** | Finds you in OpenStreetMap when you have no website. |

Press **Find my restaurant**. Everything found appears with the source under each field —
"Your website", "OpenStreetMap", "Google Maps link" — and any disagreement between sources is
shown in amber, e.g. *OpenStreetMap says 4710-294* next to a postal code from your own site.
Correct anything, then **Save these details**.

Nothing is saved by the lookup. What you submit on the review screen is what gets written, so a
field you clear stays empty. Ordering channels (table, takeaway, delivery) are never switched on
for you.

Measured against a real restaurant (Casa de Marrocos, Braga) from a Maps link plus
`casademarrocos.com`: 18 fields in 1.2 s — name, street, postal code, city, phone, WhatsApp,
email, all seven days of opening hours, website, Instagram, Facebook, Glovo, Uber Eats, Google
reviews link, cuisine and coordinates.

## Sources, and the limits on each

### The restaurant's own website — the primary source
Read in three passes: schema.org JSON-LD (`Restaurant`/`LocalBusiness`), then `tel:`/`mailto:`
links, social and delivery-platform links and meta description, then the visible text for the
address and a day-by-day hours list. The owner controls this page, so it outranks everything
else. Opening-hours day names and "closed" are recognised in the five languages MenuNiva
supports.

### Google Maps — the link is read, the page is not
Google's `robots.txt` disallows `/maps/` (checked 2026-10-31; only a short allow-list such as
`/maps/search/` and `/maps/@` is permitted). MenuNiva therefore **never downloads a Maps place
page**. Two things happen instead:

1. The pasted URL is parsed as a string. A Maps place link already contains the place name and
   the pin's coordinates (`!3d<lat>!4d<lon>`), so no request is needed.
2. A `maps.app.goo.gl` short link is resolved by reading the `Location` header of its `302`.
   That host is a link shortener and serves no robots.txt; the page it points at is never
   requested.

### Google Places — official API, only with a key
Set `GOOGLE_PLACES_API_KEY` to use Google's own address, phone, website and opening hours
through the documented Places API (New). Without a key, discovery reports
"Google Places is not connected" rather than implying Google data was unavailable.

### OpenStreetMap — addresses and name search
Through the public Nominatim service. This is the only source that can find a restaurant from
nothing but a name and city, and it turns a Maps link's coordinates into a street address. Its
usage policy is honoured: MenuNiva's own User-Agent, a shared one-second gate between calls, and
discovery only ever runs when an owner presses the button (20 lookups per hour per restaurant).

**A reverse lookup contributes the address only.** Verified against a real Maps pin: the nearest
OSM element was the confectioner next door, so its name, phone, hours and social links would
have belonged to another business. Taking only the street, postal code and city avoids that.

## Rules that keep the result trustworthy

- **Nothing is invented.** A detail that cannot be read stays empty for the owner to type.
- **Every field carries its source** and keeps the other sources' values as alternatives, so a
  disagreement is visible instead of silently resolved.
- **Precedence**: what the owner typed → their website → Google Places → OpenStreetMap → the
  Maps link. The place *name* from a Maps link beats a reverse-geocoded one.
- **A day is only "closed" when a source says so.** Unreadable times leave the day unknown,
  because publishing a wrong closed day would turn guests away.
- **Postal codes are validated for the country** (PT `0000-000`, ES `00000`) before they can
  reach the form.
- **Links must be https and on the right host**, reusing the Channels page's rules.
- **One transaction.** Details and links are validated together and written together, so one bad
  link cannot leave the address saved and the links not.
- **Requests identify MenuNiva** (`MenuNiva-Setup/1.0 (+…/setup-bot)`) and go through the
  SSRF-guarded client; `safeFetch` refuses any caller trying to pass a non-MenuNiva User-Agent.

## Where the code lives

| Piece | File |
|---|---|
| Field types, sources and reports | `src/server/discovery/types.ts` |
| Opening-hours parsing (schema.org, OSM, page text, 5 languages) | `src/server/discovery/hours.ts` |
| The restaurant's own website | `src/server/discovery/website.ts` |
| Maps URL parsing, short-link resolution, Places API | `src/server/discovery/google.ts` |
| Nominatim search and reverse lookup | `src/server/discovery/osm.ts` |
| Merging with attribution, and saving a reviewed profile | `src/server/discovery/service.ts` |
| The one-screen UI | `src/app/dashboard/[org]/setup/magic-setup.tsx` |

## Tests

| Scope | File |
|---|---|
| Opening hours: spans, lists, two sittings, 12-hour clocks, 5 languages, stray matches | `tests/unit/discovery-hours.test.ts` |
| Website and Maps URL parsing, against a real restaurant's markup | `tests/unit/discovery-website.test.ts` |
| Source precedence, OSM lookups, and what saving writes | `tests/integration/magic-setup.test.ts` |
| The owner's journey in a browser | `tests/e2e/magic-setup.spec.ts` |

No test touches the network: the website, the Maps short link and Nominatim are all answered
from fixtures (`tests/e2e/net-fixtures.ts`, and injected fetchers in the integration tests).

## Still to do

The other wizard steps (branding, tables, channels, kitchen stations) still have their own pages;
discovery replaces the **Restaurant details** step and pre-fills the links used by **Channels**.
See `TODO.md` → M3-02c.
