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
