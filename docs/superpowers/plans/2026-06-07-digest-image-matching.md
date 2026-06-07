# Digest Image Matching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Request images from Perplexity (`return_images: true`), match one image per accepted headline via a deterministic origin-url → slug → title-fuzzy tier ladder, and surface the outcome through logs + the e2e print harness — compute & log only, no persistence, no app changes.

**Architecture:** A new pure module `cron/src/lib/imageUtils.ts` holds the image type, thresholds, `normalizeUrlKey`, and `matchImages` (pre-filter → 4 tiers → dedup). `parseHeadlines` calls it after `accepted` is computed, attaches `imageUrl` to each `RegionHeadline` and `imageUrl/method/score` to each `HeadlineQuality`, emits a concise summary line, and dumps every raw image once (TEMP). The e2e `print.ts` shows the result per headline.

**Tech Stack:** TypeScript (Node), existing cron pipeline, Jest (no new tests this slice — testing deferred per design spec), ESLint/Prettier.

---

## Decisions locked from spec reconciliation

The design spec uses aspirational paths; the real files are:

| Spec reference                        | Real file                                                                          |
| ------------------------------------- | ---------------------------------------------------------------------------------- |
| §1 `fetchNews.ts` `buildPayload`      | `cron/src/fetchNews.ts` (private `buildPayload`)                                   |
| §2 two completion types               | `cron/src/lib/perplexityClient.ts` + `cron/src/lib/parseHeadlines.ts` (local copy) |
| §3 new pure module                    | `cron/src/lib/imageUtils.ts`                                                       |
| §4 wiring + summary log + §7 raw dump | `cron/src/lib/parseHeadlines.ts`                                                   |
| §5 types                              | `cron/src/types.ts`                                                                |
| §6 inspection surface                 | `cron/e2e/print.ts` (`printHeadlines`)                                             |

**Resolution of the spec's threading gap (§5/§6/§7):** `HeadlineQuality` is per _accepted_ headline and has no place for `dropped[]`/`unmatched[]`. Those are therefore surfaced only via the §7 raw dump (`log.debug` lines from `parseHeadlines`), which the spec already mandates must log _every_ image once. The e2e `print.ts` per-region summary shows matched count + method breakdown (derivable from `digest.quality.headlines`); the dropped/unmatched detail lives in the raw-dump log, not the JSONL. This avoids threading new arrays through `ParseResult` → `fetchNews` → `RegionDigest`.

**Testing:** none this slice (user-confirmed; spec defers all tests to a later spike-settling spec).

**Branch:** already on `feat/digest-image-matching`. No worktree needed.

---

### Task 1: Export `tokenise` from urlUtils (DRY tokeniser)

**Files:**

- Modify: `cron/src/lib/urlUtils.ts`

- [ ] **Step 1: Export the existing private `tokenise`**

In `cron/src/lib/urlUtils.ts`, change the declaration so the same tokeniser can be reused by `imageUtils`:

```ts
export function tokenise(title: string): string[] {
  return (title.toLowerCase().match(/\w+/g) ?? []).filter((w) => w.length >= 4);
}
```

(Only the leading `export` is added; body is unchanged. `matchUrl` in the same file keeps using it directly.)

- [ ] **Step 2: Typecheck**

Run: `cd cron && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add cron/src/lib/urlUtils.ts
git commit -m "refactor(cron): export tokenise for reuse by image matching"
```

---

### Task 2: New pure module `imageUtils.ts`

**Files:**

- Create: `cron/src/lib/imageUtils.ts`

- [ ] **Step 1: Write the module**

Create `cron/src/lib/imageUtils.ts` with this exact content:

```ts
import { tokenise, urlSlug } from './urlUtils';

/** One image as returned by Perplexity when `return_images: true` is set. */
export interface PerplexityImage {
  image_url: string;
  origin_url: string;
  title?: string;
  width?: number;
  height?: number;
}

// First-guess thresholds — expected to be tuned against live image data (see design spec).
export const MIN_IMAGE_WIDTH = 400;
export const MIN_IMAGE_HEIGHT = 400;
export const IMAGE_TITLE_THRESHOLD = 3;

export type ImageMatchMethod = 'origin-exact' | 'origin-slug' | 'title-fuzzy' | 'none';

export interface ImageMatch {
  imageUrl: string | null;
  method: ImageMatchMethod;
  score: number;
  /** The claimed image (undefined when method === 'none') — enables the raw per-image dump. */
  image?: PerplexityImage;
}

export interface DroppedImage {
  image_url: string;
  width?: number;
  height?: number;
  reason: 'bad-url' | 'too-small';
}

export interface MatchImagesResult {
  /** Aligned 1:1 with the `headlines` input order. */
  matches: ImageMatch[];
  /** Images removed by the pre-filter, with the reason. */
  dropped: DroppedImage[];
  /** Surviving images that no headline claimed. */
  unmatched: PerplexityImage[];
}

/** host+path, lowercased, with protocol / www / trailing slash / query / hash stripped. */
export function normalizeUrlKey(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    const path = u.pathname.replace(/\/+$/, '').toLowerCase();
    return host + path;
  } catch {
    return '';
  }
}

/** Missing or non-http(s) (covers `data:` URIs and empty strings). */
function isBadUrl(url: string): boolean {
  if (!url) return true;
  return !/^https?:\/\//i.test(url);
}

function titleOverlap(a: string | undefined, b: string): number {
  if (!a) return 0;
  const words = new Set(tokenise(a));
  return tokenise(b).filter((w) => words.has(w)).length;
}

/**
 * Resolve an imageUrl per headline. Anchors on the trusted origin_url first
 * (exact -> slug), then falls back to fuzzy title overlap. Each image is claimed
 * by at most one headline (dedup via a usedImageUrls set, mirroring batchUrls).
 *
 * Order is deliberately the reverse of URL matching: by image-match time the
 * headline url is already resolved and trusted, so origin_url is the high-precision
 * signal and title-fuzzy is the fallback.
 */
export function matchImages(
  headlines: Array<{ title: string; url: string }>,
  images: PerplexityImage[],
): MatchImagesResult {
  const dropped: DroppedImage[] = [];
  const pool: PerplexityImage[] = [];

  for (const img of images) {
    if (isBadUrl(img.image_url)) {
      dropped.push({
        image_url: img.image_url,
        width: img.width,
        height: img.height,
        reason: 'bad-url',
      });
      continue;
    }
    const tooSmall =
      (img.width !== undefined && img.width < MIN_IMAGE_WIDTH) ||
      (img.height !== undefined && img.height < MIN_IMAGE_HEIGHT);
    if (tooSmall) {
      dropped.push({
        image_url: img.image_url,
        width: img.width,
        height: img.height,
        reason: 'too-small',
      });
      continue;
    }
    pool.push(img);
  }

  const usedImageUrls = new Set<string>();
  const matches: ImageMatch[] = headlines.map((h) => {
    const hKey = normalizeUrlKey(h.url);
    const hSlug = urlSlug(h.url);
    const avail = pool.filter((img) => !usedImageUrls.has(img.image_url));

    // Tier 1 — origin-exact
    let hit = avail.find((img) => hKey !== '' && normalizeUrlKey(img.origin_url) === hKey);
    if (hit) {
      usedImageUrls.add(hit.image_url);
      return {
        imageUrl: hit.image_url,
        method: 'origin-exact',
        score: titleOverlap(hit.title, h.title),
        image: hit,
      };
    }

    // Tier 2 — origin-slug
    hit = avail.find((img) => {
      const s = urlSlug(img.origin_url);
      return s !== '' && s === hSlug;
    });
    if (hit) {
      usedImageUrls.add(hit.image_url);
      return {
        imageUrl: hit.image_url,
        method: 'origin-slug',
        score: titleOverlap(hit.title, h.title),
        image: hit,
      };
    }

    // Tier 3 — title-fuzzy (best overlap >= threshold)
    let best: PerplexityImage | undefined;
    let bestScore = 0;
    for (const img of avail) {
      const s = titleOverlap(img.title, h.title);
      if (s >= IMAGE_TITLE_THRESHOLD && s > bestScore) {
        best = img;
        bestScore = s;
      }
    }
    if (best) {
      usedImageUrls.add(best.image_url);
      return { imageUrl: best.image_url, method: 'title-fuzzy', score: bestScore, image: best };
    }

    // Tier 4 — none
    return { imageUrl: null, method: 'none', score: 0 };
  });

  const unmatched = pool.filter((img) => !usedImageUrls.has(img.image_url));
  return { matches, dropped, unmatched };
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `cd cron && npx tsc --noEmit && npx eslint --ext .ts src/lib/imageUtils.ts`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add cron/src/lib/imageUtils.ts
git commit -m "feat(cron): add pure imageUtils image-matching module"
```

---

### Task 3: Request images + extend completion types

**Files:**

- Modify: `cron/src/fetchNews.ts` (add `return_images: true` to `buildPayload`)
- Modify: `cron/src/lib/perplexityClient.ts` (`PerplexityCompletion.images`)
- Modify: `cron/src/lib/parseHeadlines.ts` (local `PerplexityCompletion.images`)

- [ ] **Step 1: Add `return_images: true` to the payload**

In `cron/src/fetchNews.ts`, inside `buildPayload`'s returned object, add the key immediately after `model: m.name,`:

```ts
    return {
      model: m.name,
      return_images: true,
      messages: [
```

(Read the file first to match the exact `model: m.name,` line; only this one key is inserted.)

- [ ] **Step 2: Add `images` to the exported completion type**

In `cron/src/lib/perplexityClient.ts`, extend `PerplexityCompletion` (add the field after `search_results`):

```ts
export interface PerplexityCompletion {
  choices: Array<{ message: { content: string } }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    cost: { total_cost: number };
  };
  citations?: string[];
  search_results?: Array<{ title: string; url: string; snippet?: string; date?: string }>;
  images?: Array<{
    image_url: string;
    origin_url: string;
    title?: string;
    width?: number;
    height?: number;
  }>;
}
```

- [ ] **Step 3: Add `images` to the local completion copy**

In `cron/src/lib/parseHeadlines.ts`, the local `interface PerplexityCompletion` gets the same field after `search_results`:

```ts
  search_results?: Array<{ title: string; url: string; snippet?: string; date?: string }>;
  images?: Array<{
    image_url: string;
    origin_url: string;
    title?: string;
    width?: number;
    height?: number;
  }>;
```

(Inlined in both places — structurally identical to `PerplexityImage`, so `body.images` is assignable to `matchImages`'s `PerplexityImage[]` parameter without an import or cast.)

- [ ] **Step 4: Typecheck**

Run: `cd cron && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add cron/src/fetchNews.ts cron/src/lib/perplexityClient.ts cron/src/lib/parseHeadlines.ts
git commit -m "feat(cron): request return_images and type the images field"
```

---

### Task 4: Wire `matchImages` into `parseHeadlines` (+ types, summary log, raw dump)

**Files:**

- Modify: `cron/src/types.ts` (`RegionHeadline`, `HeadlineQuality`)
- Modify: `cron/src/lib/parseHeadlines.ts` (import, call, attach, log)

- [ ] **Step 1: Extend the persisted/quality types**

In `cron/src/types.ts`, add to `RegionHeadline` (after `sourceName?`):

```ts
export interface RegionHeadline {
  title: string;
  summary: string;
  detail?: string;
  url: string;
  category?: string;
  sourceName?: string;
  /** Computed by image matching — not yet persisted to the DB. */
  imageUrl?: string;
}
```

And add to `HeadlineQuality` (after `summaryHasUrl`):

```ts
  /** True when Perplexity embedded a hyperlink inside the summary text. */
  summaryHasUrl: boolean;
  /** Image-match outputs (spike) — computed, not persisted. */
  imageUrl?: string;
  imageMatchMethod?: string;
  imageMatchScore?: number;
```

- [ ] **Step 2: Import `matchImages` in parseHeadlines**

In `cron/src/lib/parseHeadlines.ts`, add to the import block near the top (alongside the `./urlUtils` and `./textUtils` imports):

```ts
import { matchImages } from './imageUtils';
```

- [ ] **Step 3: Match, attach, log — insert before the final `return`**

In `cron/src/lib/parseHeadlines.ts`, the function currently ends with:

```ts
  const accepted = filtered.slice(0, count);
  accepted.forEach(({ headline }) => {
    usedUrls.add(headline.url);
    const slug = urlSlug(headline.url);
    if (slug) usedSlugs.add(slug);
  });

  return {
    headlines: accepted.map((c) => c.headline),
    qualities: accepted.map((c) => c.quality),
    candidatesGenerated: candidates.length + preFilterDropCount,
    urlFilterDropCount,
    modelFallbackCount,
  };
}
```

Insert this block **between** the `accepted.forEach(...)` and the `return {`:

```ts
// ── Image matching (spike: compute & log only — no persistence) ──
const acceptedHeadlines = accepted.map((c) => c.headline);
const imageResult = matchImages(acceptedHeadlines, body.images ?? []);
accepted.forEach(({ headline, quality }, i) => {
  const m = imageResult.matches[i];
  if (m.imageUrl) headline.imageUrl = m.imageUrl;
  quality.imageUrl = m.imageUrl ?? undefined;
  quality.imageMatchMethod = m.method;
  quality.imageMatchScore = m.score;
});

const rawImageCount = (body.images ?? []).length;
const droppedCount = imageResult.dropped.length;
const survivingCount = rawImageCount - droppedCount;
const methodCounts: Record<'origin-exact' | 'origin-slug' | 'title-fuzzy', number> = {
  'origin-exact': 0,
  'origin-slug': 0,
  'title-fuzzy': 0,
};
let matchedCount = 0;
for (const m of imageResult.matches) {
  if (m.method !== 'none') {
    matchedCount++;
    methodCounts[m.method]++;
  }
}
log.info(
  `images: ${rawImageCount} raw, ${droppedCount} dropped (too-small/bad-url), ` +
    `matched ${matchedCount}/${survivingCount} — exact:${methodCounts['origin-exact']} ` +
    `slug:${methodCounts['origin-slug']} fuzzy:${methodCounts['title-fuzzy']}`,
);

// TEMP: image-quality spike — remove before prod.
// Logs every returned image exactly once (matched ∪ dropped ∪ unmatched), all fields.
const dim = (w?: number, h?: number) => `${w ?? '?'}x${h ?? '?'}`;
imageResult.matches.forEach((m, i) => {
  if (!m.image) return;
  const img = m.image;
  log.debug(
    `[img] ${dim(img.width, img.height)} matched(${m.method}) "${img.title ?? ''}" ` +
      `${img.image_url} ← ${img.origin_url} (→ ${acceptedHeadlines[i].title})`,
  );
});
imageResult.dropped.forEach((d) =>
  log.debug(`[img] ${dim(d.width, d.height)} dropped(${d.reason}) ${d.image_url}`),
);
imageResult.unmatched.forEach((img) =>
  log.debug(
    `[img] ${dim(img.width, img.height)} unmatched "${img.title ?? ''}" ` +
      `${img.image_url} ← ${img.origin_url}`,
  ),
);
// END TEMP
```

- [ ] **Step 4: Typecheck + lint**

Run: `cd cron && npx tsc --noEmit && npx eslint --ext .ts src`
Expected: no errors. (If lint flags the `methodCounts[m.method]` index, confirm the `m.method !== 'none'` guard narrows correctly — it should.)

- [ ] **Step 5: Commit**

```bash
git add cron/src/types.ts cron/src/lib/parseHeadlines.ts
git commit -m "feat(cron): match images per headline, log summary and raw dump"
```

---

### Task 5: Inspection surface — `e2e/print.ts`

**Files:**

- Modify: `cron/e2e/print.ts` (`printHeadlines`)

- [ ] **Step 1: Show imageUrl + method per headline, plus a per-region summary**

In `cron/e2e/print.ts`, replace the `printHeadlines` function with:

```ts
export function printHeadlines(digest: RegionDigest): void {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${digest.region}`);
  console.log(`${'─'.repeat(60)}`);
  digest.headlines.forEach((item, i) => {
    console.log(`${i + 1}. [${item.category ?? 'news'}] ${item.title}`);
    console.log(`   ${item.summary}`);
    if (item.detail) console.log(`   ${item.detail}`);
    console.log(`   ${item.sourceName ? `Source: ${item.sourceName}` : 'Source:'} ${item.url}`);
    const q = digest.quality?.headlines[i];
    console.log(
      `   ${item.imageUrl ? `🖼  ${item.imageUrl}  (${q?.imageMatchMethod ?? '?'})` : '— no image'}\n`,
    );
  });

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
}
```

(Note: the source line no longer has a trailing `\n`; the blank-line separation moved onto the new image line.)

- [ ] **Step 2: Typecheck + lint the e2e file**

Run: `cd cron && npx tsc --noEmit && npx eslint --ext .ts e2e/print.ts`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add cron/e2e/print.ts
git commit -m "feat(cron): print imageUrl, match method, and per-region image summary"
```

---

### Task 6: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Typecheck the whole cron package**

Run: `cd cron && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 2: Lint all packages (root, covers src + e2e)**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 3: Format check (root)**

Run: `npm run format:check`
Expected: passes. If it fails, run `npm run format`, then `git add -A && git commit -m "style: prettier"`.

- [ ] **Step 4: Run existing cron tests (no new tests; confirm none broke)**

Run: `cd cron && npm test`
Expected: all existing suites pass. The new `imageUrl` field on `RegionHeadline`/`HeadlineQuality` is optional, so `fetchNews`/`pipeline`/`qualityLog` tests should be unaffected.

- [ ] **Step 5: Confirm the branch is clean and ready**

Run: `git status` and `git log --oneline -6`
Expected: working tree clean; commits from Tasks 1–5 present.

---

## Self-review against the spec

- §1 `return_images: true` → Task 3 ✔
- §2 both completion types gain `images` → Task 3 ✔
- §3 `imageUtils.ts` (type, constants, `normalizeUrlKey`, `matchImages` with `dropped`/`unmatched`, dedup, `tokenise` reused) → Tasks 1 + 2 ✔
- §4 wiring + concise summary log line → Task 4 ✔
- §5 `RegionHeadline.imageUrl`, `HeadlineQuality.imageUrl/Method/Score` → Task 4 ✔
- §6 print imageUrl + method + per-region summary → Task 5 ✔ (dropped count intentionally not in print — see "threading gap" resolution)
- §7 raw per-image dump, all fields, grouped per call, marked `TEMP` → Task 4 ✔
- Out of scope (persistence, app UI, tests) → honored ✔

```

```
