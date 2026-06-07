import type { HeadlineQuality } from '../types';
import type { RegionHeadline } from '../types';
import {
  matchUrl,
  isModelUrlPlausible,
  isValidHeadlineUrl,
  urlSlug,
  isFakePlaceholder,
} from './urlUtils';
import { stripCitations, summaryHasUrl } from './textUtils';

type Log = { debug(msg: string): void; info(msg: string): void; warn(msg: string): void };

interface PerplexityCompletion {
  choices: Array<{ message: { content: string } }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    cost: { total_cost: number };
  };
  citations?: string[];
  search_results?: Array<{ title: string; url: string; snippet?: string; date?: string }>;
}

interface ParseResult {
  headlines: RegionHeadline[];
  qualities: HeadlineQuality[];
  candidatesGenerated: number;
  urlFilterDropCount: number;
  modelFallbackCount: number;
}

export async function parseHeadlines(
  body: PerplexityCompletion,
  count: number,
  log: Log,
  usedUrls: Set<string>,
  usedSlugs: Set<string>,
  round: number,
): Promise<ParseResult> {
  const content = body.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('Response missing content');

  let parsed: { headlines: unknown[] };
  try {
    parsed = JSON.parse(content) as { headlines: unknown[] };
  } catch {
    throw new Error('Failed to parse Perplexity JSON response');
  }
  if (!Array.isArray(parsed.headlines)) throw new Error('Response missing headlines array');

  const batchUrls = new Set(usedUrls);
  const candidates: Array<{ headline: RegionHeadline; quality: HeadlineQuality }> = [];
  let modelFallbackCount = 0;
  let preFilterDropCount = 0;

  for (const item of parsed.headlines) {
    const h = item as Record<string, unknown>;
    if (typeof h.title !== 'string' || typeof h.summary !== 'string' || typeof h.url !== 'string') {
      throw new Error('Headline item missing required fields');
    }
    const summary = stripCitations(h.summary);
    const detail = typeof h.detail === 'string' ? stripCitations(h.detail) || undefined : undefined;
    const { url: matchedUrl, score: matchScore } = matchUrl(
      h.title,
      body.search_results ?? [],
      batchUrls,
    );
    const confirmedBySearch =
      !matchedUrl && (body.search_results ?? []).some((r) => r.url === h.url);
    if (!matchedUrl) {
      modelFallbackCount++;
      if (!confirmedBySearch && !isModelUrlPlausible(h.title, h.url)) {
        log.debug(`URL: model (rejected — no slug-title overlap) → ${h.url}`);
        preFilterDropCount++;
        continue;
      }
    }
    const resolvedUrl = matchedUrl ?? h.url;
    const urlSource = matchedUrl
      ? 'search_results'
      : confirmedBySearch
        ? 'model (confirmed)'
        : 'model';
    log.debug(`URL: ${urlSource} (score=${matchScore.toFixed(1)}) → ${resolvedUrl}`);
    batchUrls.add(resolvedUrl);

    candidates.push({
      headline: {
        title: h.title,
        summary,
        detail,
        url: resolvedUrl,
        category: typeof h.category === 'string' ? h.category : undefined,
        sourceName: typeof h.source_name === 'string' ? h.source_name : undefined,
      },
      quality: {
        title: h.title,
        url: resolvedUrl,
        urlSource: matchedUrl ? 'search_results' : 'model',
        urlMatchScore: matchScore,
        recencyRound: round,
        summaryHasUrl: summaryHasUrl(summary),
      } as HeadlineQuality,
    });
  }

  const seenInBatch = new Set<string>();
  const filtered = candidates.filter(({ headline }) => {
    if (!isValidHeadlineUrl(headline.url) || isFakePlaceholder(headline.title)) return false;
    if (seenInBatch.has(headline.url)) return false;
    const slug = urlSlug(headline.url);
    if (slug && usedSlugs.has(slug)) {
      log.info(`Slug duplicate filtered: ${headline.url}`);
      return false;
    }
    seenInBatch.add(headline.url);
    return true;
  });

  const urlFilterDropCount = candidates.length - filtered.length + preFilterDropCount;
  if (urlFilterDropCount > 0)
    log.info(
      `Filtered ${urlFilterDropCount} invalid headline(s) (video/junk/slug-dupe/model-mismatch)`,
    );

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
