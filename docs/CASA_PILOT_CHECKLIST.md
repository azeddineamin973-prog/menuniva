# Casa de Marrocos — Internal Pilot Readiness Checklist

Goal: a **closed, internal pilot** with Casa de Marrocos staff on a private machine before any real guest
orders. Do **not** publish the platform, print QR codes for the dining room, or share links with guests
until section 15 says so.

Legend: **[YOU]** = only you / the restaurant can provide it · **[MN]** = done in MenuNiva by you or me ·
**[BLOCKED]** = needs hosting, hardware or a provider.

Current state of the real tenant (development database, read on 2026-10-30, nothing changed):
`casa-de-marrocos`, status ONBOARDING, not published; location "Casa de Marrocos — Braga",
Rua de Santa Margarida 13, 15 e 17, Braga, phone +351 935 413 677, Europe/Lisbon; areas: Sala principal,
Zona de assentos marroquinos, Terraço interior, Tenda marroquina (café); stations: Cozinha (piso inferior)
(Kitchen), Café / Chá (Café). **Missing:** owner account (the only invitation was revoked), postal code,
opening hours, dishes, prices, allergens, tables, Google review link. Two other development tenants
(`casa-de-maroccos`, `huihugiy`) look like test sign-ups — see docs/OPEN_BUGS.md; nothing is deleted
without your approval.

## 1. Secure owner account
- [ ] **[YOU]** Choose the owner email (a mailbox the owner controls).
- [ ] **[MN]** `npm run setup:casa -- --owner-email=<email>` → open the printed invitation link (7 days), create the account with a password of 12+ characters from a password manager.
- [ ] **[MN]** Sign in, open **My account**, set the dashboard language; sign out and back in.
- [ ] **[YOU]** Decide who else is OWNER/MANAGER (keep owners to 1–2 people).
- [ ] **[MN]** Create the Super Admin for the platform only if needed: `npm run setup:admin-token` (one-time link).

## 2. Restaurant contact information
- [ ] **[YOU]** Confirm legal/trading name, address, **postal code (NNNN-NNN)**, phone, WhatsApp number, website/Instagram/Facebook links.
- [ ] **[YOU]** Weekly **opening hours** (also used for takeaway/delivery when no specific hours are set; takeaway/delivery cannot be switched on without hours).
- [ ] **[MN]** Settings → Restaurant details / Opening hours / Links.

## 3. Real menu entry
- [ ] **[YOU]** The current printed or digital menu (PDF with selectable text, Excel/CSV, or the Glovo/Uber merchant export).
- [ ] **[MN]** Import Studio: add the source, review every item, **choose the Kitchen or Café station for each category**, publish as drafts first; or enter dishes manually.
- [ ] **[MN]** Check Menu: no "dishes not sent to any kitchen screen" warning remains.

## 4. Verified product prices
- [ ] **[YOU]** Confirm every dine-in price (and takeaway/delivery prices if they differ).
- [ ] **[MN]** Compare the Menu page with the printed menu line by line; Glovo/Uber prices are only references and never become in-house prices.
- [ ] **[YOU]** Confirm the IVA (VAT) classes your accountant uses (Settings → Tax).

## 5. Allergen review
- [ ] **[YOU]** For every dish, the 14 EU allergens ("contains" / "may contain") from the kitchen.
- [ ] **[MN]** Enter and **verify** per dish; unverified allergen information is never shown to guests.
- [ ] **[YOU]** Approve the allergy notice text shown in the cart.

## 6. Five-language review
- [ ] **[YOU]** Native or fluent reviewers for PT, EN, FR, AR, ES (Arabic is shown right-to-left).
- [ ] **[MN]** Menu → Translations: fill in, then "Mark translations as reviewed". Automatic translation is **not configured** (EXT-08); untranslated text falls back to Portuguese.

## 7. Tables and QR codes
- [ ] **[YOU]** The real table numbers per area and seats.
- [ ] **[MN]** Tables & QR: create tables, download the PDF sheet.
- [ ] **[BLOCKED]** Print QR codes only **after** the final domain exists — QR codes contain `APP_BASE_URL`; codes printed for `localhost` will not work for guests.

## 8. Kitchen and Café setup
- [ ] **[MN]** Stations exist (Kitchen, Café). Every category has a default station.
- [ ] **[YOU]** A tablet or screen for the kitchen and one for the café, on the restaurant Wi-Fi, logged in as kitchen/café staff; sound on.
- [ ] **[MN]** Print a test ticket from each station (browser print / PDF). Direct thermal printing is **not implemented** (EXT-06).

## 9. Staff permissions
- [ ] **[YOU]** List of staff and roles (owner, manager, waiter, kitchen, café, delivery).
- [ ] **[MN]** Staff → invitations (links are shown on screen; MenuNiva does not send emails yet — EXT-04). Check each role sees only its screens.

## 10. Order acceptance testing (internal, test dishes only if needed)
- [ ] **[MN]** With staff phones: scan a table QR on the local network, order food + tea, accept, prepare on Kitchen and Café, mark ready, complete.
- [ ] **[MN]** Two people order at the same table at the same time → one bill.
- [ ] **[MN]** Turn Wi-Fi off during "Send order" → the phone says it could not confirm; "Check and try again" never creates a second order.

## 11. Cancellation and payment testing
- [ ] **[MN]** Cancel an order with a reason; reduce an item with a reason (discount re-calculated).
- [ ] **[MN]** Record cash and card-terminal payments; split one bill by items and by amount; close the table.
- [ ] **[YOU]** Agree the closing routine (unpaid balance requires a reason).
- [ ] **[BLOCKED]** Online payments and certified invoices (AT-certified software) are **not** in MenuNiva: the receipt says "NÃO É FATURA"; keep using your certified invoicing system (EXT-10, EXT-11).

## 12. Staff training (≈ 1 hour)
- [ ] Waiters: live orders, accept/cancel, waiter/bill requests, bills and payments.
- [ ] Kitchen/Café: their display only, start/ready, priority orders.
- [ ] Owner/manager: menu, sold-out, prices, translations, analytics (order value vs. collected payments), feedback inbox.

## 13. Backup and recovery plan
- [ ] **[MN]** Run `npm run backup` daily during the pilot; copy the file (encrypted) off the machine.
- [ ] **[MN]** Practise one restore into an empty database (`npm run restore`, see docs/DEPLOYMENT.md §5).
- [ ] **[BLOCKED]** Scheduled, off-site backups and point-in-time recovery need the production database (EXT-02).

## 14. Privacy and legal requirements
- [ ] **[YOU]** Privacy notice for guests (data controller = the restaurant; what is stored: orders, optional name/phone for takeaway/delivery, feedback contact only when asked, loyalty with consent, a functional `mn_guest` cookie for abuse protection).
- [ ] **[YOU]** Data-processing agreement between the restaurant and MenuNiva; data retention period (Settings → Privacy).
- [ ] **[YOU]** Allergen information responsibility (EU 1169/2011) stays with the restaurant.
- [ ] **[YOU]** Confirm with your accountant that internal receipts are not invoices.

## 15. Hosting and domain requirements (before any guest uses it)
- [ ] **[YOU]** Choose hosting, a domain and a managed EU PostgreSQL with point-in-time recovery.
- [ ] **[MN]** Follow docs/DEPLOYMENT.md: https, `TRUST_PROXY_HOPS` (§2.1, app port not reachable from the internet), real `APP_SECRET`, backups, monitoring.
- [ ] **[MN]** Verify from two different networks that client IPs are recorded correctly and that a forged `X-Forwarded-For` is ignored.
- [ ] Then: print QR codes with the final domain.

## 16. Safe internal pilot procedure
1. Pilot runs on a private machine/network, staff only; no QR codes on guest tables yet.
2. One service (lunch) with staff acting as guests, real menu, real prices.
3. Keep paper as fallback: if MenuNiva is unavailable, take orders by hand — nothing is lost because orders already sent are stored in the database.
4. After the service: compare MenuNiva analytics (order value, collected payments) with the till; note every problem.
5. Fix, repeat for 3–5 services, then decide on hosting (section 15) and a first real-guest service with one area only (e.g. Terraço interior).
6. Daily backup during the whole pilot.

## What you must provide manually (summary)
Owner email · postal code · opening hours · full menu with verified prices · allergen declarations ·
reviewed translations (FR/AR/ES/EN) · table list · staff list and roles · tablets for Kitchen and Café ·
Google review link (Google Business Profile → "Ask for reviews") · privacy notice and DPA · accountant's
confirmation on receipts/invoices · hosting, domain and database choice.
