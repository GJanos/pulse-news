# Slice 1 — Currency rates & data freshness

Date: 2026-06-02
Status: Approved — ready for implementation plan

Post-parity V1 polish. Four related changes in the digest data layer, grouped into one PR to `develop`.

---

## 1. Live currency rates via Frankfurter v2

**Files:** `app/src/hooks/useCurrencyRates.ts` (+ tests)

Replace the `@fawazahmed0/currency-api` source (jsDelivr CDN + `currency-api.pages.dev` mirror) with the Frankfurter **v2** API — keyless, ECB-backed, supports an arbitrary base. (v2 verified against the live API; v1 remains supported but v2 is the current docs.)

- Today: `GET https://api.frankfurter.dev/v2/rates?base=<BASE>&quotes=<csv>`
- Prior day: `GET https://api.frankfurter.dev/v2/rates?date=<yesterdayDate>&base=<BASE>&quotes=<csv>`
- `<BASE>` = uppercase `baseCurrency`; `<csv>` = comma-joined uppercase requested codes.
- Response shape: an **array** of `{ date, base, quote, rate }` objects, e.g. `[{ "date":"2026-06-02","base":"USD","quote":"GBP","rate":0.74273 }, …]`. Uppercase ISO quote codes. `base` is honored; `date` is the actual published date for the requested day.

Changes to the hook:

- Rewrite `fetchRates(base, date)` to call the v2 URL and reduce the array into `{ date, rates }`, where `rates` is a `quote → rate` map and `date` is the first element's `date` (`''` if the array is empty). Drop the nested `json[base]` lookup, the lowercase-key handling, and the second mirror (Frankfurter is single-origin).
- `buildCurrencyRates` keeps its current structure: fetch today, anchor "yesterday" to today's published `date` (falling back to the clock only if `date` is absent), fetch prior day, compute `changePercent = ((prev - rate) / prev) * 100`.
- Codes lookup becomes uppercase (`code.toUpperCase()` against `rates`) instead of lowercase.
- `STALE_MS` (5 min) and the `useCurrencyRates` query/`forceRefresh` surface are unchanged.

Behavior preserved: same `CurrencyRate { rate, changePercent }` output, same today-vs-yesterday semantics, same skip-when-`code === baseCurrency`, same warn/skip on missing rate.

## 2. Stop over-eager refetch mid-interaction

**Files:** `app/src/hooks/useDigestPageData.ts` (+ tests)

**Root cause:** the rebuild dropped legacy's "digestPrefs freeze." Toggling a region in Settings updates `selectedRegions` immediately → `currencyCodes` (derived from the visible buckets) changes → the React Query keyed on the sorted codes refetches while Settings is still open. Legacy settled only when the user left Settings.

**Fix:** gate the currency query so neither its enabled-state nor its effective code set changes while `screen === 'settings'`:

- Read `screen` from the store in `useDigestPageData`.
- Pass `enabled = showCurrencyRates && isToday && screen !== 'settings'` to `useCurrencyRates`.
- React Query pauses while Settings is open and fires once on return; if the code set is unchanged and data is still within `STALE_MS`, no refetch happens at all.

Scope: **currency only.** The per-region digest fetch (also keyed on regions) is left as-is — pre-fetching a newly added region's digest is acceptable and not part of the complaint.

## 3. Empty-digest force refresh — verify + regression test

**Files:** `app/src/hooks/useDigest.ts`, `app/src/storage/digests.ts` (tests only, unless a real block is found)

Investigation of the rebuild shows **no caching block**:

- A region with no remote row is never written to cache, so it is re-fetched on the next load.
- `forceRefresh` on today sets `forced` → `loadDailyDigest` runs with `staleMinutes: 0`, re-pulling from Supabase.
- Pull-to-refresh (`RefreshControl`) is mounted regardless of empty/error state.

Action: add a regression test proving an empty "today" digest does not poison the cache and that `forceRefresh` repulls. No behavior change unless implementation surfaces an actual block.

## 4. History-days off-by-one

**Files:** `app/src/components/DigestPager.tsx` (+ tests)

`historyDays: N` should mean N days back from today → today + N = N+1 pages (`7` ⇒ 8 pages). Currently `maxDayIndex = historyDays - 1` yields N pages.

- Change `maxDayIndex` to `historyDays` (clamped `>= 0`).
- Update the page-slot count (`totalSlots`) to `historyDays + 1`.
- Cache trim cutoff (`today - historyDays`) already keeps `today-historyDays`, so the oldest page has data — no trim change.

---

## Testing

- `useCurrencyRates`: Frankfurter v2 URL construction (base + quotes, today + dated), array-response reduction to a `quote → rate` map, uppercase mapping, `changePercent` math, missing-rate skip, yesterday-date anchoring.
- `useDigestPageData`: currency query disabled while `screen === 'settings'`, re-enabled on return; codes settle to final set.
- `useDigest`/`digests`: empty-today does not block force refresh.
- `DigestPager`: page count = `historyDays + 1`.

Target 60–70% on the changed logic. `/code-review` before the PR.

## Out of scope

- `currencyStaleMins` config wiring (hook still uses hardcoded 5 min).
- Gating the per-region digest fetch.
- Any cron-side currency work (currency is UI-only).
