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
