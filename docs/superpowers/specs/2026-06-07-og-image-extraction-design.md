# og:image Extraction — Design Spec

**Date:** 2026-06-07
**Branch:** `feat/digest-image-matching`
**Status:** Approved design, pending implementation plan

## Problem

The first image attempt used Perplexity's `return_images: true` and matched the
returned images to headlines via an origin-url → slug → title-fuzzy tier ladder
(`cron/src/lib/imageUtils.ts`). Live runs proved this approach structurally
unworkable:

- **The image set is a query-level side-channel, not per-article.** Perplexity
  returns ~2 images relevant to the _overall_ query, decoupled from
  `search_results`. There is **no API parameter** to request a count
  (confirmed against the `POST /v1/sonar` body schema — only `return_images`,
  `image_format_filter`, `image_domain_filter` exist).
- **Cross-outlet `origin_url` mismatch.** An image's `origin_url` is often a
  different publication than the chosen headline URL (same story, different
  outlet), so `origin-exact` and `origin-slug` never fire — every observed run
  logged `exact:0 slug:0`.
- **Ceiling ~40%.** With ~2 decoupled images and 5 headlines, even perfect
  matching cannot exceed ~40% coverage; realistic coverage was far lower.

## Goal

Replace the Perplexity image path entirely with **per-article OpenGraph
extraction**: fetch each _final ranked_ headline's article URL, read its
`og:image` (falling back to `twitter:image`), and attach it as the headline's
image. Deterministic, per-article, no matching step.

Scope is a **coverage spike**: compute-and-log + e2e print only. **No DB
persistence and no app changes** in this slice — those follow once the e2e run
confirms coverage.

## Why OpenGraph

Modern publishers embed `og:image` in every article `<head>` to render rich
link previews (Slack/iMessage/Facebook/WhatsApp). Consequences:

- **Per-article and deterministic** — we already hold the trusted, resolved
  headline URL after ranking; we fetch _that_ page and read _its_ image. No
  fuzzy matching, no cross-outlet confusion.
- **~90–98% coverage** — rich previews are table stakes; the rare miss usually
  still carries `twitter:image`.
- **Quality pre-declared** — hero images are sized for social cards (commonly
  1200×630); many sites declare `og:image:width/height`, enabling size
  filtering without downloading bytes.

## Library decision

Parse with **`cheerio@^1.2.0`** (latest). We do the fetching ourselves with
native `fetch` + `AbortController`, giving full control over timeout,
User-Agent, and concurrency.

- cheerio 1.2.0 exposes a CommonJS `require` conditional export, so it loads
  cleanly under the cron's `module: CommonJS` setting. Types are bundled.
- `engines.node >= 20.18.1` — satisfied by the Node 20 cron runtime.

> **Rejected:** `open-graph-scraper`. Its current line (v6+) is ESM-only and
> would throw `ERR_REQUIRE_ESM` under CommonJS; the last CJS-compatible release
> (v5.2.3) is an older pinned line, and it also owns the fetch, reducing our
> control over timeout/UA/concurrency.

## Architecture

### New module — `cron/src/lib/ogImage.ts`

Lean pure-module style, mirroring `urlUtils.ts` / the soon-deleted
`imageUtils.ts`.

```ts
export type ImageSource = 'og' | 'twitter' | 'none';

export interface OgImageResult {
  imageUrl: string | null;
  source: ImageSource;
  width?: number;
  height?: number;
}

// Relocated from the deleted imageUtils.ts (only consumer left is og parsing).
export const MIN_IMAGE_WIDTH = 400;
export const MIN_IMAGE_HEIGHT = 400;
```

- **`parseOgImage(html, pageUrl): OgImageResult`** — **pure; the unit-tested
  core.** `cheerio.load(html)`, then ladder:
  `og:image` (also `og:image:secure_url`, `og:image:url`) → `twitter:image`
  (`property` and `name` variants). Reads `og:image:width` / `og:image:height`
  when present. Resolves relative image URLs against `pageUrl`
  (`new URL(img, pageUrl).href`). Applies `MIN_IMAGE_WIDTH/HEIGHT` **only when
  dimensions are declared** — never drops an image for missing dimensions.
- **`fetchOgImage(url, opts?): Promise<OgImageResult>`** — thin network
  wrapper: native `fetch` with `AbortController` timeout (default 5000ms) and a
  realistic desktop `User-Agent` header (mitigates 403 bot-blocks). Reads the
  body as text and hands it to `parseOgImage`. Any throw / non-OK status /
  non-HTML content-type degrades to `{ imageUrl: null, source: 'none' }`. Not
  unit-tested (network).
- **`fetchOgImages(headlines, opts?): Promise<OgImageResult[]>`** —
  `Promise.all` over the final headlines, aligned 1:1 with input order. Regions
  already run in parallel upstream, so peak fan-out stays small (~regions × 5).

### Wiring — `cron/src/fetchNews.ts`

After `const headlines = rankResult.headlines;` (the final ranked set):

1. `const ogImages = await fetchOgImages(headlines);`
2. For each `i`: set `headlines[i].imageUrl = ogImages[i].imageUrl ?? undefined`
   and `acceptedQualities[i].imageUrl = ...`,
   `acceptedQualities[i].imageSource = ogImages[i].source`.
3. Emit one region summary log, e.g.:
   `og:image [Hungary] — 5/5 (og:5 twitter:0 none:0)`

og:image is now the **source of truth** for `RegionHeadline.imageUrl`.

### Types — `cron/src/types.ts`

- `RegionHeadline.imageUrl?: string` — **kept**, now populated from og.
- `HeadlineQuality.imageUrl?: string` — **kept**, the resolved og image.
- **Rename** `HeadlineQuality.imageMatchMethod` → `imageSource?: ImageSource`
  (semantics changed from "how we matched" to "where it came from"). Drops the
  import of `ImageMatchMethod` from the deleted `imageUtils.ts`.

### Inspection — `cron/e2e/print.ts`

Per-headline line shows the og image + source; the per-region summary line
reports `og:image: N/total (og:x twitter:y none:z)`.

## Cleanup — remove the Perplexity image path

All of the following was added on this branch and has not merged past it;
removal nets the branch diff down to the og:image solution.

- **Delete** `cron/src/lib/imageUtils.ts` (matchImages, PerplexityImage,
  normalizeUrlKey, thresholds, ImageMatchMethod). `MIN_IMAGE_WIDTH/HEIGHT`
  relocate into `ogImage.ts`.
- **`cron/src/fetchNews.ts`** — remove `return_images: true` from
  `buildPayload`.
- **`cron/src/lib/perplexityClient.ts`** — remove the `images?: [...]` field
  from `PerplexityCompletion`.
- **`cron/src/lib/parseHeadlines.ts`** — remove the `matchImages` import, the
  local `images` type, the `matchImages` call, the per-headline imageUrl
  assignment, and the raw per-image dump + `images: N raw …` summary logs.
- **`cron/src/types.ts`** — complete the `imageMatchMethod` → `imageSource`
  rename above.
- **`cron/e2e/print.ts`** — replace the Perplexity image/summary lines with the
  og equivalents.
- The superseded plan `docs/superpowers/plans/*digest-image-matching*` is left
  in history; no action needed.

## Testing

- **Unit** — `cron/src/tests/ogImage.test.ts` for `parseOgImage` against
  fixture HTML: og present; og missing but twitter present; relative image URL
  resolved against `pageUrl`; declared dimensions below threshold dropped;
  missing dimensions kept; no image tags → `none`; malformed HTML → `none`.
- **e2e** — `npm run e2e:full` against live regions; read the per-region
  `og:image` coverage summary and per-headline lines from `print.ts`. This is
  the spike's measurement.
- `fetchOgImage` / `fetchOgImages` are exercised by the e2e run, not unit
  tests.

## Risks

- **SSRF** — we now GET arbitrary article URLs server-side. They are already
  vetted by `isArticleUrl` and are the same URLs we link users to, so risk is
  low. A fuller `/security-review` belongs in the later persist/app slice.
- **Bot-blocking** — some publishers 403 non-browser UAs; the realistic UA
  mitigates, and failures degrade to `none`. Measuring this rate is part of the
  spike.
- **JS-rendered pages** — rare for news articles (og tags are in raw HTML for
  link-preview crawlers); such pages degrade to `none`.

## Out of scope (later slices)

- Persisting `imageUrl` to Supabase and surfacing it in the app.
- Image validation by fetching bytes / dimension probing beyond declared tags.
- Caching fetched og results.
