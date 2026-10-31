# Bulk setup tools: prices and kitchen routing

Two jobs that used to be done one dish at a time after importing a menu. A 73-item Glovo import
left 73 dishes with no dine-in price and no kitchen station; both are now one reviewed step.

## Use Glovo (or Uber Eats) prices for dine-in

`Dashboard → Menu → Prices & availability`, shown only when imported platform prices exist.

### Why this is a separate, explicit action

The importer deliberately keeps platform prices in `ExternalSourcePrice` and never touches
`ChannelPrice`: a delivery-platform price normally includes that platform's commission, so it is
not what the restaurant charges at its own table. That separation stays. This screen is the one
place an owner can say "use those amounts as my dine-in prices too", and it never runs on its own.

### What it does

- Lists every affected dish with its **current** price and the **proposed** amount before
  anything changes.
- Copies amounts **exactly**, in integer cents. No rounding, no mark-up, no currency conversion.
  A price in another currency is listed as skipped instead of being converted.
- Requires one explicit confirmation ("I reviewed these prices…"). Without it, nothing happens.
- **Never replaces a price the restaurant already set** unless "Replace prices I already set" is
  ticked. By default those rows are listed but unticked.
- Restores **size price differences** from the original import. The importer stores platform
  variant deltas as `0` (a platform surcharge is not ours to charge until the price is ours), but
  the absolute size prices survive in `ImportedProduct.variants`; they are matched back by
  `externalId`. Sizes the owner priced themselves are left alone — proposals are only offered
  while every delta is still `0`.
- Keeps the reference price: `ExternalSourcePrice` is copied from, never moved or deleted.
- **Pricing is not publishing.** Dishes stay drafts unless "Make these dishes visible" is ticked.

Also on the same screen: "Set one price for several dishes", for a group that all costs the same.

## Send each category to a station

`Dashboard → Kitchen stations`.

A dish with no station reaches no kitchen screen: `createKitchenTickets` skips items whose
`stationId` is null, so an unrouted dish is ordered, charged and never cooked (audit GAP-01).

- A table of every category with its current station and a **suggestion** based on the category
  name, in all five supported languages (`suggestStationType`). One submit applies the whole
  table as shown.
- Suggestions are checkable, not automatic: the select is pre-filled, the owner can change any
  row, and saving applies exactly what is on screen.
- **No station is invented.** A restaurant with none is asked which ones it uses and the stations
  are created only when it presses the button. Nothing is seeded.
- Food with no keyword match is suggested as Kitchen, but only once at least one station exists.
  Drink and dessert categories fall back sensibly (`TYPE_FALLBACKS`): drinks to a café or a bar,
  desserts to the kitchen when there is no dessert station.
- Dishes routed individually keep their own station; the category default only covers the rest.
- A **summary** counts the dishes still reaching no screen.

### Accent-sensitive keywords

`thé` (French) and `té` (Spanish) mean tea, but stripped of accents they become "the" and "te",
which appear throughout English and Portuguese menu names — "The best of the house" was being
routed to the café. Those words are matched against the accented text, before accents are
removed. A wrong station is worse than no suggestion, so anything unmatched is left to the owner.

## One definition of "unrouted"

`src/server/services/routing.ts` holds the single rule and all three callers use it: the publish
blocker, the setup checklist and this screen. They previously had separate copies and disagreed —
the checklist ignored switched-off stations, so it showed a green tick while publishing refused.

## Testing

- `tests/unit/station-suggestions.test.ts` — keywords in five languages, accents, false positives.
- `tests/integration/price-bulk.test.ts` — exact cents, no overwrite, variants, currency refusal,
  draft/visible, selection, tenant isolation.
- `tests/integration/station-assign.test.ts` — suggestions, one-submit routing proven by a real
  order reaching the right board, individual overrides kept, inactive stations, tenant isolation.
- `tests/e2e/bulk-prices-stations.spec.ts` — both screens end to end.
