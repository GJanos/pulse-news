# Digest Image Matching — Design Spec

**Date:** 2026-06-07
**Branch:** `feat/digest-image-matching`
**Scope:** cron only — spike + matching logic, compute & log only (no persistence, no app/UI)
**Status:** approved design

> Testing is intentionally **out of scope** for this spec. The exact matching
> thresholds and tiers are expected to change after real trial-and-error against
> live Perplexity image data. Once the implementation is nailed down, a separate
> smaller spec will define the test suite.

---

## Goal

Increase digest engagement by attaching a relevant image to each headline, in an
elegant, sparing way (enough to make the user want to click, not a wall of
images). Before committing to that UX, we need to **see the real data**: what
images Perplexity returns when `return_images: true` is set, and how reliably
they can be matched to the headlines we already produce.

This branch therefore does two things:

1. **Inspect** — request images and dump what comes back (urls, origin, dimensions, titles) so image quality can be judged by eye.
2. **Match** — compute an `imageUrl` per headline using the same spirit as the existing URL-to-headline matching, and surface the match outcome (which tier won, what was dropped).

Nothing is persisted to Supabase and nothing changes in the app. When the data
looks good, a follow-up branch promotes `imageUrl` into persistence (`full.ts` +
schema) and the digest UI.

## Background — how URL matching works today

For each headline the model emits (it returns both a `title` and its own `url`),
`parseHeadlines` resolves the real article URL in two tiers:

1. **Primary — `matchUrl(h.title, search_results, batchUrls)`** (`urlUtils.ts`):
   `tokenise()`s the headline title and scores it against each
   `search_result`'s title (+ 0.5 × snippet). The best result scoring ≥
   `URL_MATCH_THRESHOLD` (3) wins. The primary key is _title-tokenise against
   `search_results`_, not against the model's own url.
2. **Fallback — the model's own `h.url`** (`parseHeadlines.ts`): only reached
   when no search result matched, and guarded — accepted only if
   `confirmedBySearch` (exact url present in `search_results`) or
   `isModelUrlPlausible` (≥1 path-word from the url appears in the title).
   Otherwise the headline is dropped.

So: **tokenise first, model-url fallback second.**

## Image matching — same spirit, reversed order (deliberate)

Image matching reverses the tier order, on purpose:

- In the URL flow the url is the _unknown being derived_ — the model hallucinates
  urls, so we cannot anchor on `h.url` first; we anchor on title-tokenise.
- For images, by matching time the headline's `url` is **already resolved and
  trusted**. An image's `origin_url` (the page the image came from) is therefore
  the _high-precision_ signal. So we anchor on `origin_url` first and fall back to
  title-tokenise.

Same principle (strong deterministic signal first → tokenise fallback → graceful
no-match), order flipped for a principled reason.

### Per-headline matching tiers

For each headline, in order, the first tier that produces a confident match wins:

1. **`origin-exact`** — `normalizeUrlKey(image.origin_url) === normalizeUrlKey(headline.url)`
   (normalized = strip protocol / `www` / trailing slash / query / hash, lowercased → host+path).
2. **`origin-slug`** — `urlSlug(image.origin_url) === urlSlug(headline.url)` and non-empty
   (catches http/https, mobile `m.`, and amp variants of the same article).
3. **`title-fuzzy`** — `tokenise(image.title)` vs `tokenise(headline.title)`
   overlap ≥ `IMAGE_TITLE_THRESHOLD`.
4. **`none`** — no confident match; the headline gets no image.

### Pre-filter (before any matching)

Images are dropped up front and never enter the pool if:

- `image_url` is missing, not `http(s)`, or a `data:` URI → reason `bad-url`.
- `width` or `height` is below the minimum (`MIN_IMAGE_WIDTH` / `MIN_IMAGE_HEIGHT`,
  starting at **400px**) → reason `too-small`. This is what keeps logos, icons,
  and sprites out.

Dropped images are still reported in the dump (with reason and dimensions) so the
thresholds can be tuned from real data.

### Dedup

An image is claimed by at most one headline. A `usedImageUrls` set, mirroring the
existing `batchUrls` pattern, prevents two headlines from sharing the same image.

## Components

### 1. Request — `fetchNews.ts`

`buildPayload` adds `return_images: true` to the request body. No other request
changes.

### 2. Response type — `PerplexityCompletion`

The completion type is defined in **two** places — `lib/perplexityClient.ts` and a
local copy in `lib/parseHeadlines.ts`. Both gain:

```ts
images?: Array<{
  image_url: string;
  origin_url: string;
  title?: string;
  width?: number;
  height?: number;
}>;
```

### 3. New module — `cron/src/lib/imageUtils.ts` (pure)

Single-purpose, dependency-light, easy to reason about and tune:

- `PerplexityImage` type.
- Constants: `MIN_IMAGE_WIDTH`, `MIN_IMAGE_HEIGHT` (400), `IMAGE_TITLE_THRESHOLD`.
- `normalizeUrlKey(url: string): string` — host+path normalization described above.
- `matchImages(headlines, images)` → for each headline `{ imageUrl, method, score }`
  where `method ∈ 'origin-exact' | 'origin-slug' | 'title-fuzzy' | 'none'`, plus:
  - `dropped`: images removed by the pre-filter, each with `{ image_url, width, height, reason }`.
  - `unmatched`: surviving images that matched no headline (so we can see good images left on the table).

To keep tokenisation identical to URL matching, `tokenise` is **exported from
`urlUtils.ts`** and imported here — one tokeniser used in both places (DRY).

### 4. Wiring — `parseHeadlines.ts`

After `accepted` is computed, call `matchImages(accepted, body.images ?? [])`.
For each accepted headline: attach `imageUrl` to the `RegionHeadline`, and write
`imageUrl` / `imageMatchMethod` / `imageMatchScore` onto its parallel
`HeadlineQuality`. Emit one concise per-call log line:

```
images: N raw, D dropped (too-small/bad-url), matched M/K — exact:x slug:y fuzzy:z
```

### 5. Types — `types.ts`

- `RegionHeadline` gains `imageUrl?: string`, commented as _computed, not yet
  persisted_ (same convention as the existing `quality` field).
- `HeadlineQuality` gains `imageUrl?: string`, `imageMatchMethod?: string`,
  `imageMatchScore?: number` — so the full inspection data flows into the existing
  quality run-log (`buildRunLog` / `writeRunLog`), the natural place to eyeball
  quality across an entire run.

### 6. Inspection surface — `e2e/print.ts`

- `printHeadlines` prints each headline's `imageUrl` (or `— no image`) and its
  match method.
- A per-region summary line: matched X/N, method breakdown, dropped count.
- Deeper per-image detail (dimensions, dropped reasons, unmatched images) lands in
  the quality-log file via the `HeadlineQuality` additions.

Run exactly as today: `e2e/fetch.ts` → no DB writes.

### 7. Raw image dump — full per-image logging (temporary)

Since the human is ultimately the judge of image quality, every image returned by
Perplexity must be logged **at least once with all of its fields** —
`image_url`, `origin_url`, `title`, `width`, `height` — regardless of whether it
was matched, dropped, or left unmatched. Nothing is hidden behind aggregate
counts.

Requirements:

- **Complete:** every field of every returned image appears in the log at least
  once per run. No silent truncation of the image array.
- **Non-crowded but informative:** one image per line (or a tight, scannable
  block), each line tagged with its outcome and dimensions, e.g.:

  ```
  [img] 1200x630  matched(origin-exact)  "Story headline title"  https://cdn…/photo.jpg  ← https://site.com/article
  [img]  64x64    dropped(too-small)      "Logo"                  https://cdn…/logo.png  ← https://site.com
  [img] 800x450   unmatched               "Unrelated photo"       https://cdn…/x.jpg     ← https://other.com/p
  ```

- **Grouped per region/call** so it reads alongside the headlines it belongs to.
- **Explicitly temporary:** this raw dump is for the spike only and will be
  removed before any production code. Mark it clearly in-code (e.g. a
  `// TEMP: image-quality spike — remove before prod` comment) so it is trivial to
  strip later.

This dump is in addition to the concise summary line in §4 and the structured
`HeadlineQuality` data in §5 — those stay; this raw per-image dump goes away.

## Data flow

```
Perplexity (return_images: true)
  → body.images[]                       (perplexityClient / fetchNews)
  → parseHeadlines: resolve urls (unchanged) → accepted headlines
  → matchImages(accepted, body.images)  (imageUtils, pure)
      ├─ pre-filter (too-small / bad-url)  → dropped[]
      ├─ per-headline tiers (exact → slug → fuzzy → none), dedup
      → { imageUrl, method, score } per headline + unmatched[]
  → attach imageUrl to RegionHeadline
  → write imageUrl/method/score to HeadlineQuality
  → e2e/print.ts + quality run-log  (inspection)
```

## Out of scope

- Supabase persistence (`image_url` column, `full.ts` writes).
- App / digest UI rendering.
- Any test suite — deferred to a separate, smaller spec once the matching tiers
  and thresholds settle after live trial-and-error.

## Risks & notes

- `return_images` may carry extra API cost. The existing `usage.cost` logging will
  surface it on the first run — no extra instrumentation needed.
- The 400px cutoff and `IMAGE_TITLE_THRESHOLD` are first guesses; the dump reports
  enough to tune them.
- Fully revertable: no schema, no app, no `full.ts` changes.
