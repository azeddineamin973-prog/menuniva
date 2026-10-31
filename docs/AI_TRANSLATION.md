# AI menu translation (OpenRouter)

Fills every missing language on the menu from the restaurant's own text, for staff to check.

## What an owner sees

`Dashboard → Menu → Translations`:

1. **How much work and what it costs.** The panel shows how many translations are missing, how
   many requests that takes, the estimated tokens and the estimated price in USD, read from
   OpenRouter's published price list for the configured model. If that list cannot be read the
   cost is shown as *unknown* rather than guessed.
2. **Translate all with AI.** Runs in bounded passes with a real progress bar. Anything that
   fails is listed; pressing the button again retries only what is still missing.
3. **Review and approve.** Machine translations are stored as *waiting for review* and are
   invisible to guests. "Review all" filters the list to exactly those items; approving them all
   requires ticking a confirmation, because that is the moment the text becomes public.
4. **Per-item editing.** Every row can be edited or approved on its own, and one row can be
   translated on its own with "Translate with AI".

## Configuration

```
TRANSLATION_PROVIDER=openrouter
OPENROUTER_API_KEY=sk-or-...
OPENROUTER_MODEL=google/gemini-2.5-flash-lite
```

Without a key the page says no provider is connected and the manual editor still works. Nothing
is translated in the background: every call comes from an owner pressing a button.

## Guarantees

| Promise | Where it is enforced |
|---|---|
| The source language is never written to or overwritten | `translateMissing` targets `enabledLanguages` minus `sourceLanguage`, and only fills languages with no row at all |
| A translation staff wrote or approved is never replaced | only missing `(row, language)` pairs are collected (`translationPlan`) |
| Guests never see unreviewed AI text | rows are written `MACHINE`; `pickTranslation` in `public-menu.ts` skips `MACHINE` and falls back to the source language |
| Ingredients and allergens are never machine-translated | only `name` and `description` are sent; `ingredients` is never passed or written |
| No customer data is sent | only menu text is in the request body |
| Output is checked before storage | one answer per input, matched by index, non-empty, length-sane (`parseTranslationResponse`) |
| No duplicate rows | `createMany({ skipDuplicates: true })` on the `(id, language)` unique key |
| Cost is capped | 200 provider requests per hour per restaurant (`REQUESTS_PER_HOUR`) |

## How batching works

One request carries up to `BATCH_ITEMS` (20) rows for **one** target language, as a flat array of
`[name, description, name, description, …]`. The model is asked for
`{"items":[{"i":1,"text":"…"}]}`; an index per item means a dropped or reordered line is
detectable, where a bare array would silently shift every following translation onto the wrong
dish.

A pass handles `DEFAULT_PASS_LIMIT` (120) missing cells and returns how many are left, so the
browser can show progress and continue. Each pass is independent: finished cells are skipped and
failed ones are simply still missing, so the next pass retries them. Nothing is half-written —
a batch is stored only after its whole answer validates.

## Source-language detection

"Check my menu language" asks the model what the menu is actually written in and warns when that
disagrees with the configured source language, because translating from the wrong original
produces poor results. It only warns: the setting is never changed automatically.

## Arabic

Arabic is written in Arabic script (stated in the instructions) and every editor field uses
`dir="rtl"` for it, as do the storefront and the dashboard via `dirOf()`.

## Testing

- `tests/unit/ai-translate.test.ts` — answer parsing, index gaps, malformed output, batching, cost estimate.
- `tests/integration/ai-translation.test.ts` — against a stand-in provider: missing-only, source
  untouched, MACHINE hidden from guests, approval gate, no ingredients sent, failure/retry,
  no duplicates, tenant isolation.
- `tests/e2e/ai-translation.spec.ts` — the real screens, with the model answered locally by
  `standInModelFetch` (test environment only). No billed call and no internet access.

The browser suite sets `TRANSLATION_PROVIDER=openrouter` with a placeholder key; because
`TEST_FETCH_FIXTURES` is set, `getTranslationProvider` substitutes the local stand-in model.
`env.ts` refuses `TEST_FETCH_FIXTURES` outside `APP_ENV=test`, so this cannot happen in a real
deployment.
