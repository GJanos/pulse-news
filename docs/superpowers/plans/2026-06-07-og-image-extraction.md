# og:image Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Perplexity `return_images` image-matching path with per-article OpenGraph extraction — fetch each final-ranked headline's article URL, read its `og:image` (falling back to `twitter:image`), and attach it as the headline's image.

**Architecture:** A new pure-core module `cron/src/lib/ogImage.ts` parses og/twitter meta tags from HTML (`parseOgImage`, unit-tested) behind a thin native-`fetch` network wrapper (`fetchOgImage`/`fetchOgImages`, exercised by e2e). `fetchNews.ts` calls it on the final ranked set and writes `imageUrl` onto headlines + quality records. The entire Perplexity image path (the `imageUtils.ts` module, `return_images`, the `images` API field, and the matching logs) is removed.

**Tech Stack:** TypeScript (CommonJS, ES2020, Node 20), cheerio 1.2.0 for HTML parsing, native `fetch` + `AbortController`, Jest + ts-jest.

**Spec:** `docs/superpowers/specs/2026-06-07-og-image-extraction-design.md`

---

## File Structure

- **Create** `cron/src/lib/ogImage.ts` — og:image extraction (types, `parseOgImage`, `fetchOgImage`, `fetchOgImages`, `MIN_IMAGE_WIDTH/HEIGHT`).
- **Create** `cron/src/tests/ogImage.test.ts` — unit tests for `parseOgImage`.
- **Modify** `cron/package.json` — add `cheerio` dependency.
- **Modify** `cron/src/types.ts` — rename `imageMatchMethod` → `imageSource: ImageSource`, drop `imageMatchScore`.
- **Modify** `cron/src/lib/parseHeadlines.ts` — remove the entire image-matching block + `imageUtils` import + local `images` field.
- **Modify** `cron/src/lib/perplexityClient.ts` — remove the `images?` field from `PerplexityCompletion`.
- **Modify** `cron/src/fetchNews.ts` — remove `return_images: true`; wire `fetchOgImages` on the ranked set.
- **Modify** `cron/e2e/print.ts` — replace Perplexity image/summary lines with og equivalents.
- **Delete** `cron/src/lib/imageUtils.ts`.

Ordering keeps each commit compiling: new module first, then strip writers of the renamed field (parseHeadlines), then the API field (perplexityClient), then the coupled rename (types + print together), then the new wiring (fetchNews), then delete the now-orphaned module, then full verification.

---

### Task 1: Add the cheerio dependency

**Files:**

- Modify: `cron/package.json`

- [ ] **Step 1: Install cheerio (adds to dependencies + lockfile)**

```bash
cd cron && npm install cheerio@^1.2.0
```

- [ ] **Step 2: Verify it resolves and exposes a CommonJS entry**

Run: `cd cron && node -e "const c = require('cheerio'); console.log(typeof c.load)"`
Expected: prints `function` (confirms cheerio loads under CommonJS — the reason we chose it over ESM-only open-graph-scraper).

- [ ] **Step 3: Commit**

```bash
git add cron/package.json cron/package-lock.json
git commit -m "build(cron): add cheerio for og:image parsing"
```

---

### Task 2: Create the ogImage module (TDD)

**Files:**

- Create: `cron/src/lib/ogImage.ts`
- Test: `cron/src/tests/ogImage.test.ts`

- [ ] **Step 1: Write the failing test**

Create `cron/src/tests/ogImage.test.ts`:

```ts
import { parseOgImage, MIN_IMAGE_WIDTH } from '../lib/ogImage';

const PAGE = 'https://news.example.com/world/article-123';

describe('parseOgImage', () => {
  it('reads og:image and reports source "og"', () => {
    const html = `<html><head>
      <meta property="og:image" content="https://cdn.example.com/hero.jpg">
    </head></html>`;
    expect(parseOgImage(html, PAGE)).toEqual({
      imageUrl: 'https://cdn.example.com/hero.jpg',
      source: 'og',
      width: undefined,
      height: undefined,
    });
  });

  it('falls back to twitter:image when og:image is absent', () => {
    const html = `<html><head>
      <meta name="twitter:image" content="https://cdn.example.com/tw.jpg">
    </head></html>`;
    const r = parseOgImage(html, PAGE);
    expect(r.imageUrl).toBe('https://cdn.example.com/tw.jpg');
    expect(r.source).toBe('twitter');
  });

  it('prefers og:image over twitter:image', () => {
    const html = `<html><head>
      <meta property="og:image" content="https://cdn.example.com/og.jpg">
      <meta name="twitter:image" content="https://cdn.example.com/tw.jpg">
    </head></html>`;
    expect(parseOgImage(html, PAGE).source).toBe('og');
    expect(parseOgImage(html, PAGE).imageUrl).toBe('https://cdn.example.com/og.jpg');
  });

  it('uses og:image:secure_url when og:image is missing', () => {
    const html = `<html><head>
      <meta property="og:image:secure_url" content="https://cdn.example.com/secure.jpg">
    </head></html>`;
    expect(parseOgImage(html, PAGE).imageUrl).toBe('https://cdn.example.com/secure.jpg');
    expect(parseOgImage(html, PAGE).source).toBe('og');
  });

  it('resolves a relative image URL against pageUrl', () => {
    const html = `<html><head>
      <meta property="og:image" content="/media/hero.jpg">
    </head></html>`;
    expect(parseOgImage(html, PAGE).imageUrl).toBe('https://news.example.com/media/hero.jpg');
  });

  it('keeps an image whose declared dimensions meet the minimum', () => {
    const html = `<html><head>
      <meta property="og:image" content="https://cdn.example.com/hero.jpg">
      <meta property="og:image:width" content="1200">
      <meta property="og:image:height" content="630">
    </head></html>`;
    expect(parseOgImage(html, PAGE)).toEqual({
      imageUrl: 'https://cdn.example.com/hero.jpg',
      source: 'og',
      width: 1200,
      height: 630,
    });
  });

  it('drops an image whose declared dimensions are below the minimum', () => {
    const small = MIN_IMAGE_WIDTH - 1;
    const html = `<html><head>
      <meta property="og:image" content="https://cdn.example.com/thumb.jpg">
      <meta property="og:image:width" content="${small}">
      <meta property="og:image:height" content="100">
    </head></html>`;
    expect(parseOgImage(html, PAGE)).toEqual({ imageUrl: null, source: 'none' });
  });

  it('keeps an image when dimensions are not declared', () => {
    const html = `<html><head>
      <meta property="og:image" content="https://cdn.example.com/hero.jpg">
    </head></html>`;
    expect(parseOgImage(html, PAGE).imageUrl).toBe('https://cdn.example.com/hero.jpg');
  });

  it('returns none when no image tags are present', () => {
    const html = `<html><head><title>No image here</title></head></html>`;
    expect(parseOgImage(html, PAGE)).toEqual({ imageUrl: null, source: 'none' });
  });

  it('returns none for malformed / empty HTML', () => {
    expect(parseOgImage('', PAGE)).toEqual({ imageUrl: null, source: 'none' });
    expect(parseOgImage('<<not really html', PAGE)).toEqual({ imageUrl: null, source: 'none' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd cron && npx jest ogImage`
Expected: FAIL — `Cannot find module '../lib/ogImage'`.

- [ ] **Step 3: Write the implementation**

Create `cron/src/lib/ogImage.ts`:

```ts
import * as cheerio from 'cheerio';

export type ImageSource = 'og' | 'twitter' | 'none';

export interface OgImageResult {
  imageUrl: string | null;
  source: ImageSource;
  width?: number;
  height?: number;
}

export interface FetchOgImageOptions {
  timeoutMs?: number;
  userAgent?: string;
}

// Relocated from the deleted imageUtils.ts — og parsing is the only consumer left.
export const MIN_IMAGE_WIDTH = 400;
export const MIN_IMAGE_HEIGHT = 400;

const DEFAULT_TIMEOUT_MS = 5000;
// A realistic desktop UA — many publishers 403 non-browser agents.
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

type CheerioAPI = ReturnType<typeof cheerio.load>;

/** First non-empty `content` attribute across the given meta selectors, in order. */
function firstContent($: CheerioAPI, selectors: string[]): string | undefined {
  for (const sel of selectors) {
    const v = $(sel).attr('content')?.trim();
    if (v) return v;
  }
  return undefined;
}

function toDimension(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Pure, unit-tested core. Reads og:image (with secure_url/url variants), falling
 * back to twitter:image. Resolves relative URLs against pageUrl, and drops an
 * image only when its *declared* dimensions are below the minimum — never for
 * missing dimensions.
 */
export function parseOgImage(html: string, pageUrl: string): OgImageResult {
  const $ = cheerio.load(html);

  const og = firstContent($, [
    'meta[property="og:image"]',
    'meta[property="og:image:secure_url"]',
    'meta[property="og:image:url"]',
  ]);
  const twitter = firstContent($, [
    'meta[name="twitter:image"]',
    'meta[property="twitter:image"]',
    'meta[name="twitter:image:src"]',
    'meta[property="twitter:image:src"]',
  ]);

  const raw = og ?? twitter;
  if (!raw) return { imageUrl: null, source: 'none' };
  const source: ImageSource = og ? 'og' : 'twitter';

  let imageUrl: string;
  try {
    imageUrl = new URL(raw, pageUrl).href;
  } catch {
    return { imageUrl: null, source: 'none' };
  }

  const width = toDimension(firstContent($, ['meta[property="og:image:width"]']));
  const height = toDimension(firstContent($, ['meta[property="og:image:height"]']));

  if (
    (width !== undefined && width < MIN_IMAGE_WIDTH) ||
    (height !== undefined && height < MIN_IMAGE_HEIGHT)
  ) {
    return { imageUrl: null, source: 'none' };
  }

  return { imageUrl, source, width, height };
}

/**
 * Network wrapper around parseOgImage. Any failure (timeout, non-OK status,
 * non-HTML body, parse error) degrades to { imageUrl: null, source: 'none' }.
 * Not unit-tested (network) — exercised by the e2e run.
 */
export async function fetchOgImage(
  url: string,
  opts: FetchOgImageOptions = {},
): Promise<OgImageResult> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, userAgent = DEFAULT_USER_AGENT } = opts;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': userAgent, Accept: 'text/html,application/xhtml+xml' },
      redirect: 'follow',
    });
    if (!res.ok) return { imageUrl: null, source: 'none' };
    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.includes('html')) return { imageUrl: null, source: 'none' };
    const html = await res.text();
    return parseOgImage(html, url);
  } catch {
    return { imageUrl: null, source: 'none' };
  } finally {
    clearTimeout(timer);
  }
}

/** Fetches og images for headlines in parallel, aligned 1:1 with input order. */
export async function fetchOgImages(
  headlines: Array<{ url: string }>,
  opts?: FetchOgImageOptions,
): Promise<OgImageResult[]> {
  return Promise.all(headlines.map((h) => fetchOgImage(h.url, opts)));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd cron && npx jest ogImage`
Expected: PASS — all `parseOgImage` cases green.

- [ ] **Step 5: Typecheck**

Run: `cd cron && npx tsc --noEmit`
Expected: no errors (confirms the cheerio import + native `fetch`/`AbortController` globals type-check).

- [ ] **Step 6: Commit**

```bash
git add cron/src/lib/ogImage.ts cron/src/tests/ogImage.test.ts
git commit -m "feat(cron): add ogImage module with parseOgImage and fetch helpers"
```

---

### Task 3: Remove the image-matching block from parseHeadlines

**Files:**

- Modify: `cron/src/lib/parseHeadlines.ts`

- [ ] **Step 1: Remove the imageUtils import**

Delete line 11:

```ts
import { matchImages } from './imageUtils';
```

- [ ] **Step 2: Remove the `images` field from the local PerplexityCompletion interface**

In the `interface PerplexityCompletion` block, delete these lines:

```ts
  images?: Array<{
    image_url: string;
    origin_url: string;
    title?: string;
    width?: number;
    height?: number;
  }>;
```

- [ ] **Step 3: Remove the entire image-matching + raw-dump section**

Delete everything from the comment `// ── Image matching (spike: compute & log only — no persistence) ──` (currently line 143) through the `// END TEMP` comment (currently line 197) inclusive. After deletion, the code goes directly from the `accepted.forEach(...)` block that populates `usedUrls`/`usedSlugs` to:

```ts
return {
  headlines: accepted.map((c) => c.headline),
  qualities: accepted.map((c) => c.quality),
  candidatesGenerated: candidates.length + preFilterDropCount,
  urlFilterDropCount,
  modelFallbackCount,
};
```

(The deleted section was the only consumer of `matchImages`, `acceptedHeadlines`, and `body.images`.)

- [ ] **Step 4: Typecheck**

Run: `cd cron && npx tsc --noEmit`
Expected: no errors. (`imageUtils.ts` still exists but is now unused — deleted in Task 7. `quality.imageMatchMethod` is no longer written, only declared/read — still valid.)

- [ ] **Step 5: Run the test suite**

Run: `cd cron && npm test`
Expected: PASS — no test referenced the removed image path.

- [ ] **Step 6: Commit**

```bash
git add cron/src/lib/parseHeadlines.ts
git commit -m "refactor(cron): remove Perplexity image-matching from parseHeadlines"
```

---

### Task 4: Remove the images field from the Perplexity client type

**Files:**

- Modify: `cron/src/lib/perplexityClient.ts`

- [ ] **Step 1: Delete the `images?` field**

In `export interface PerplexityCompletion`, delete lines 13–19:

```ts
  images?: Array<{
    image_url: string;
    origin_url: string;
    title?: string;
    width?: number;
    height?: number;
  }>;
```

- [ ] **Step 2: Typecheck**

Run: `cd cron && npx tsc --noEmit`
Expected: no errors. (`fetchNews.ts` imports this type but never reads `.images`.)

- [ ] **Step 3: Commit**

```bash
git add cron/src/lib/perplexityClient.ts
git commit -m "refactor(cron): drop images field from PerplexityCompletion"
```

---

### Task 5: Rename imageMatchMethod → imageSource (types + print)

**Files:**

- Modify: `cron/src/types.ts`
- Modify: `cron/e2e/print.ts`

These change together so the commit compiles: `types.ts` defines the field, `print.ts` is its only reader.

- [ ] **Step 1: Add the ImageSource import to types.ts**

At the top of `cron/src/types.ts`, add:

```ts
import type { ImageSource } from './lib/ogImage';
```

- [ ] **Step 2: Replace the three image fields on HeadlineQuality**

In `cron/src/types.ts`, replace:

```ts
  /** Image-match outputs (spike) — computed, not persisted. */
  imageUrl?: string;
  imageMatchMethod?: string;
  imageMatchScore?: number;
```

with:

```ts
  /** og:image outputs (spike) — computed, not persisted. */
  imageUrl?: string;
  imageSource?: ImageSource;
```

- [ ] **Step 3: Update print.ts per-headline line**

In `cron/e2e/print.ts`, replace the per-headline image block inside `digest.headlines.forEach`:

```ts
const q = digest.quality?.headlines[i];
console.log(
  `   ${item.imageUrl ? `🖼  ${item.imageUrl}  (${q?.imageMatchMethod ?? '?'})` : '— no image'}\n`,
);
```

with (look up the quality by URL, since ranking reorders headlines relative to `quality.headlines`):

```ts
const q = digest.quality?.headlines.find((h) => h.url === item.url);
console.log(
  `   ${item.imageUrl ? `🖼  ${item.imageUrl}  (${q?.imageSource ?? '?'})` : '— no image'}\n`,
);
```

- [ ] **Step 4: Update print.ts per-region summary**

In `cron/e2e/print.ts`, replace:

```ts
// Per-region image summary (dropped/unmatched detail is in the parseHeadlines raw-dump log).
const qs = digest.quality?.headlines ?? [];
const matched = qs.filter((q) => q.imageUrl).length;
const byMethod = qs.reduce<Record<string, number>>((acc, q) => {
  const k = q.imageMatchMethod ?? 'none';
  acc[k] = (acc[k] ?? 0) + 1;
  return acc;
}, {});
const breakdown = Object.entries(byMethod)
  .map(([k, v]) => `${k}:${v}`)
  .join(' ');
console.log(`  images: matched ${matched}/${digest.headlines.length} — ${breakdown}`);
```

with:

```ts
// Per-region og:image summary.
const qs = digest.quality?.headlines ?? [];
const withImage = qs.filter((q) => q.imageUrl).length;
const bySource = qs.reduce<Record<string, number>>((acc, q) => {
  const k = q.imageSource ?? 'none';
  acc[k] = (acc[k] ?? 0) + 1;
  return acc;
}, {});
const breakdown = Object.entries(bySource)
  .map(([k, v]) => `${k}:${v}`)
  .join(' ');
console.log(`  og:image: ${withImage}/${digest.headlines.length} — ${breakdown}`);
```

- [ ] **Step 5: Typecheck**

Run: `cd cron && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add cron/src/types.ts cron/e2e/print.ts
git commit -m "refactor(cron): rename HeadlineQuality.imageMatchMethod to imageSource"
```

---

### Task 6: Wire og:image extraction into fetchNews

**Files:**

- Modify: `cron/src/fetchNews.ts`

- [ ] **Step 1: Remove `return_images` from the request payload**

In `buildPayload`, delete line 76:

```ts
      return_images: true,
```

- [ ] **Step 2: Add the ogImage imports**

Near the other imports at the top of `cron/src/fetchNews.ts`, add:

```ts
import { fetchOgImages } from './lib/ogImage';
import type { ImageSource } from './lib/ogImage';
```

- [ ] **Step 3: Fetch og images on the ranked set and attach them**

In `fetchDigest`, immediately after this line (currently line 237):

```ts
const acceptedQualities = allQualities.slice(0, count);
```

insert:

```ts
// ── og:image extraction (spike: compute & log only — no persistence) ──
// headlines is the ranked order; align quality records back by URL.
const ogImages = await fetchOgImages(headlines);
const ogCounts: Record<ImageSource, number> = { og: 0, twitter: 0, none: 0 };
headlines.forEach((h, i) => {
  const og = ogImages[i];
  if (!og) return;
  h.imageUrl = og.imageUrl ?? undefined;
  ogCounts[og.source]++;
  const q = acceptedQualities.find((x) => x.url === h.url);
  if (q) {
    q.imageUrl = og.imageUrl ?? undefined;
    q.imageSource = og.source;
  }
});
logger.info(
  `og:image [${region}] — ${ogCounts.og + ogCounts.twitter}/${headlines.length} ` +
    `(og:${ogCounts.og} twitter:${ogCounts.twitter} none:${ogCounts.none})`,
);
```

- [ ] **Step 4: Typecheck**

Run: `cd cron && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Run the test suite**

Run: `cd cron && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add cron/src/fetchNews.ts
git commit -m "feat(cron): extract og:image per ranked headline, drop return_images"
```

---

### Task 7: Delete the orphaned imageUtils module

**Files:**

- Delete: `cron/src/lib/imageUtils.ts`

- [ ] **Step 1: Confirm nothing imports it**

Run: `cd cron && npx tsc --noEmit` after deletion (Step 2). First verify by search — expect zero matches:

Run (PowerShell): `Select-String -Path cron/src/**/*.ts,cron/e2e/**/*.ts -Pattern "imageUtils" -SimpleMatch`
Expected: no output.

- [ ] **Step 2: Delete the file**

```bash
git rm cron/src/lib/imageUtils.ts
```

- [ ] **Step 3: Typecheck**

Run: `cd cron && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git commit -m "refactor(cron): delete unused imageUtils Perplexity matcher"
```

---

### Task 8: Full verification + coverage spike

**Files:** none (validation only)

- [ ] **Step 1: Lint, typecheck, test, format (root)**

```bash
cd cron && npx eslint --ext .ts src && npx tsc --noEmit && npm test
cd .. && npm run format:check
```

Expected: all green. If `format:check` flags files, run `npm run format` from root, then `git add -A && git commit -m "style: prettier formatting"`.

- [ ] **Step 2: Run the live coverage spike**

Run: `cd cron && npm run e2e:full`
Expected: per region a log line `og:image [<Region>] — N/M (og:x twitter:y none:z)` and, in the printed digest, per-headline `🖼 <url> (og|twitter)` lines plus the `og:image: N/M — og:x twitter:y none:z` summary. Read these to measure live coverage — this is the spike's deliverable.

- [ ] **Step 3: Record the measured coverage**

Note the per-region og/twitter/none breakdown from Step 2 in the PR description (and any 403/none patterns worth flagging for the later persist/app slice).

---

## Notes for the implementer

- **Native globals:** `fetch`, `Response`, `AbortController`, and `setTimeout` are Node 20 globals already typed via `@types/node` — no imports needed (see existing `perplexityClient.ts`).
- **`noUncheckedIndexedAccess` is on:** array indexing yields `T | undefined`. The `ogImages[i]` access in Task 6 is guarded with `if (!og) return;` for this reason — keep the guard.
- **Why URL alignment in Tasks 5/6:** `rankHeadlines` returns a reordered `headlines` array (`indices.map((i) => headlines[i - 1])`), so `headlines[i]` does not correspond to `acceptedQualities[i]`. Aligning quality records by `url` keeps the source label correct. `headlines[i]` ↔ `ogImages[i]` _is_ 1:1 (same array passed to `fetchOgImages`), so that index pairing is safe.
- **SSRF / bot-blocking:** out of scope for this spike beyond the existing `isArticleUrl` vetting and the realistic UA; a fuller `/security-review` belongs to the later persist/app slice (per spec Risks).
