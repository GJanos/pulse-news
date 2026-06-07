const VIDEO_DOMAINS = [/youtube\.com/, /youtu\.be/, /vimeo\.com/];
const JUNK_PATH_PATTERNS = [
  /\/topic\//,
  /\/tag\//,
  /\/category\//,
  /\/search\?/,
  /\?q=/,
  /\/newsletters?\//,
  /\/press-center/,
  /\/press-releases?\//,
  /\/digest\//,
  /\/roundup\//,
  /\/playbook\//,
  /\/live-blog\//,
  /\/live\//,
];
const SOCIAL_DOMAINS = [
  /twitter\.com/,
  /\/x\.com/,
  /facebook\.com/,
  /instagram\.com/,
  /tiktok\.com/,
];

export function isArticleUrl(url: string): boolean {
  return !VIDEO_DOMAINS.some((p) => p.test(url));
}

export function urlSlug(url: string): string {
  try {
    const segments = new URL(url).pathname.split('/').filter(Boolean);
    return segments[segments.length - 1] ?? '';
  } catch {
    return '';
  }
}

export function isValidHeadlineUrl(url: string): boolean {
  try {
    const { pathname } = new URL(url);
    if (!pathname || pathname === '/') return false;
    const segments = pathname.split('/').filter(Boolean);
    if (segments.length < 2 && (segments[0]?.length ?? 0) < 20) return false;
    return ![...VIDEO_DOMAINS, ...JUNK_PATH_PATTERNS, ...SOCIAL_DOMAINS].some((p) => p.test(url));
  } catch {
    return false;
  }
}

export function isFakePlaceholder(title: string): boolean {
  const t = title.toLowerCase();
  return (
    t.includes('no news') || t.includes('no stories') || t === 'none' || t.includes('not available')
  );
}

export function isModelUrlPlausible(title: string, url: string): boolean {
  try {
    const { pathname } = new URL(url);
    const pathWords = pathname.toLowerCase().match(/[a-z]{4,}/g) ?? [];
    if (pathWords.length < 3) return true;
    const titleWords = new Set(title.toLowerCase().match(/[a-z]{4,}/g) ?? []);
    return pathWords.some((w) => titleWords.has(w));
  } catch {
    return true;
  }
}

const URL_MATCH_THRESHOLD = 3;

interface SearchResult {
  title: string;
  url: string;
  snippet?: string;
  date?: string;
}

export function tokenise(title: string): string[] {
  return (title.toLowerCase().match(/\w+/g) ?? []).filter((w) => w.length >= 4);
}

export function matchUrl(
  title: string,
  results: SearchResult[],
  usedUrls: Set<string>,
): { url: string | null; score: number } {
  const articles = results.filter((r) => isValidHeadlineUrl(r.url) && !usedUrls.has(r.url));
  const words = new Set(tokenise(title));
  let bestScore = -1;
  let bestUrl: string | null = null;
  for (const r of articles) {
    const titleScore = tokenise(r.title).filter((w) => words.has(w)).length;
    const snippetScore = tokenise(r.snippet ?? '').filter((w) => words.has(w)).length * 0.5;
    const score = titleScore + snippetScore;
    if (score >= URL_MATCH_THRESHOLD && score > bestScore) {
      bestScore = score;
      bestUrl = r.url;
    }
  }
  return { url: bestUrl, score: bestUrl ? bestScore : 0 };
}

export { VIDEO_DOMAINS, JUNK_PATH_PATTERNS, SOCIAL_DOMAINS };
