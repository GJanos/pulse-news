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
// Height floor tuned down from 400 against live data: legit landscape news cards
// (e.g. ukrinform's 630×360) were being dropped; 300 keeps them while still
// excluding logos/icons.
export const MIN_IMAGE_WIDTH = 400;
export const MIN_IMAGE_HEIGHT = 300;
// Reject square and portrait images (ratio <= 1.0) when both dimensions are declared.
// Publisher brand logos served as og:image defaults (e.g. NPR 1400×1400) are square;
// real editorial news photos are always landscape.
export const MIN_ASPECT_RATIO = 1.0;

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
    (height !== undefined && height < MIN_IMAGE_HEIGHT) ||
    (width !== undefined && height !== undefined && width / height <= MIN_ASPECT_RATIO)
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

/**
 * Nulls out any imageUrl that appears more than once in a batch. Repeated URLs
 * are site-wide defaults (publisher logos, placeholder art) not editorial photos.
 */
export function deduplicateOgImages(results: OgImageResult[]): OgImageResult[] {
  const urlCount = new Map<string, number>();
  for (const r of results) {
    if (r.imageUrl) urlCount.set(r.imageUrl, (urlCount.get(r.imageUrl) ?? 0) + 1);
  }
  return results.map((r) => {
    if (r.imageUrl && (urlCount.get(r.imageUrl) ?? 0) > 1) {
      return { imageUrl: null, source: 'none' };
    }
    return r;
  });
}

/** Fetches og images for headlines in parallel, aligned 1:1 with input order. */
export async function fetchOgImages(
  headlines: Array<{ url: string }>,
  opts?: FetchOgImageOptions,
): Promise<OgImageResult[]> {
  const results = await Promise.all(headlines.map((h) => fetchOgImage(h.url, opts)));
  return deduplicateOgImages(results);
}
