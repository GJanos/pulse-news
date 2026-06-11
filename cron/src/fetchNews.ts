import { buildFetchSystemPrompt, buildFetchUserPrompt } from './prompt';
import { callPerplexity } from './lib/perplexityClient';
import type { PerplexityCompletion } from './lib/perplexityClient';
import { parseHeadlines } from './lib/parseHeadlines';
import { getLogger } from './logging';
import { isArticleUrl } from './lib/urlUtils';
import { isDuplicateTopic, calcAvgTopicSpread } from './lib/topicUtils';
import type { PulseConfig } from '@shared/config';
import type {
  HeadlineQuality,
  DigestQuality,
  RegionHeadline,
  RegionDigest,
  DigestRequest,
  DigestSource,
} from './types';
import { rankHeadlines } from './rankHeadlines';
import type { RankingResult } from './rankHeadlines';
import { fetchOgImages } from './lib/ogImage';
import type { ImageSource } from './lib/ogImage';

type Log = { debug(msg: string): void; info(msg: string): void; warn(msg: string): void };

interface ParseResult {
  headlines: RegionHeadline[];
  qualities: HeadlineQuality[];
  candidatesGenerated: number;
  urlFilterDropCount: number;
  modelFallbackCount: number;
}

// Enforces strict JSON output via response_format — eliminates markdown wrapping and freeform fallbacks.
const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    headlines: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          summary: { type: 'string' },
          detail: { type: 'string' },
          url: { type: 'string' },
          category: { type: 'string' },
          source_name: { type: 'string' },
        },
        required: ['title', 'summary', 'detail', 'url', 'category', 'source_name'],
        additionalProperties: false,
      },
    },
  },
  required: ['headlines'],
  additionalProperties: false,
};

/**
 * Extracts the bare domains from curated source labels like "Telex (telex.hu)".
 * Entries without a parenthesised domain are skipped — they cannot be expressed
 * as a `search_domain_filter` entry.
 */
export function domainsFromSources(sources: string[]): string[] {
  const out: string[] = [];
  for (const s of sources) {
    const m = /\(([a-z0-9.-]+\.[a-z]{2,})(?:\/[^)]*)?\)/i.exec(s);
    if (m?.[1]) out.push(m[1].toLowerCase());
  }
  return [...new Set(out)];
}

export class PerplexitySource implements DigestSource {
  private readonly apiKey: string;
  private readonly config: PulseConfig;
  private readonly endpoint = 'https://api.perplexity.ai/chat/completions';

  constructor(config: PulseConfig, apiKey = process.env.PERPLEXITY_API_KEY) {
    if (!apiKey) throw new Error('PERPLEXITY_API_KEY is not set');
    this.apiKey = apiKey;
    this.config = config;
  }

  private buildPayload(
    region: string,
    country: string,
    sources: string[],
    count: number,
    recency: 'hour' | 'day' | 'week' | 'month' | 'year',
    round: number,
  ) {
    const m = this.config.model;
    // Early rounds restrict search to the curated outlets (hard allowlist —
    // the prompt hint alone is routinely ignored); later rounds open up so a
    // quiet news day can still fill the digest.
    const domains =
      round < this.config.api.fetch.domainFilterRounds ? domainsFromSources(sources) : [];
    return {
      model: m.name,
      messages: [
        {
          role: 'system',
          content: buildFetchSystemPrompt(
            this.config.api.fetch.summarySentences,
            this.config.api.fetch.detailSentences,
          ),
        },
        { role: 'user', content: buildFetchUserPrompt(region, count, sources) },
      ],
      reasoning_effort: m.reasoningEffort,
      temperature: m.temperature,
      language_preference: 'en',
      search_recency_filter: recency,
      ...(domains.length > 0 ? { search_domain_filter: domains } : {}),
      web_search_options: {
        search_context_size: m.searchContextSize,
        search_type: m.searchType,
        user_location: { country },
      },
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'news_digest',
          description: 'Structured news digest with headlines and summaries',
          strict: true,
          schema: RESPONSE_SCHEMA,
        },
      },
    };
  }

  // MAX_ATTEMPTS is intentionally low: failed requests still incur the base search cost (~$0.005).
  private async callPerplexity(payload: object, log: Log): Promise<PerplexityCompletion> {
    return callPerplexity(
      this.endpoint,
      this.apiKey,
      payload,
      log,
    ) as Promise<PerplexityCompletion>;
  }

  private async parseHeadlines(
    body: PerplexityCompletion,
    count: number,
    log: Log,
    usedUrls: Set<string>,
    usedSlugs: Set<string>,
    round: number,
  ): Promise<ParseResult> {
    return parseHeadlines(
      body as Parameters<typeof parseHeadlines>[0],
      count,
      log,
      usedUrls,
      usedSlugs,
      round,
    );
  }

  /** Fetches headlines for one region, retrying with wider recency windows until minFetchResults is reached. */
  async fetchDigest({ region, country, sources, count = 5 }: DigestRequest): Promise<RegionDigest> {
    const logger = getLogger('fetchNews');
    logger.info(`Fetching ${count} headlines — ${region} (${country})`);

    const logBody = (body: PerplexityCompletion, recency: string) => {
      const u = body.usage;
      logger.info(
        `[${region}] recency=${recency} — ${u.prompt_tokens}+${u.completion_tokens}=${u.total_tokens} tokens | $${u.cost.total_cost.toFixed(6)}`,
      );
      if (body.citations?.length) logger.debug(`Citations: ${body.citations.join(' | ')}`);
      if (body.search_results?.length) {
        const articles = body.search_results.filter((r) => isArticleUrl(r.url));
        logger.debug(
          `Search results: ${body.search_results.length} total, ${articles.length} articles — ${articles.map((r) => `[${r.title}] ${r.url}`).join(' | ')}`,
        );
      }
      logger.debug(`Raw content: ${body.choices?.[0]?.message?.content}`);
    };

    // Duplicates are intentional: retry the same window once before widening, since a second
    // call to the same recency often returns different candidates from the live search index.
    const recencies = this.config.api.fetch.recencySequence;
    const collected: RegionHeadline[] = [];
    const allQualities: HeadlineQuality[] = [];
    const usedUrls = new Set<string>();
    const usedSlugs = new Set<string>();
    const {
      minResults: minFetchResults,
      maxAttempts: maxFetchAttempts,
      retryDelay: fetchRetryAttemptDelay,
      buffer: fetchBuffer,
    } = this.config.api.fetch;
    let totalUsage = {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
      cost: { total_cost: 0 },
    };
    let attempts = 0;
    let totalCandidatesGenerated = 0;
    let totalUrlFilterDropCount = 0;
    let totalModelFallbackCount = 0;
    let topicDropCount = 0;
    const recenciesUsed: string[] = [];

    for (
      let i = 0;
      i < Math.min(maxFetchAttempts, recencies.length) && collected.length < minFetchResults;
      i++
    ) {
      attempts = i + 1;
      const recency = recencies[i]!;
      recenciesUsed.push(recency);
      const remaining = count - collected.length;
      if (i > 0) {
        logger.info(
          `[${region}] ${collected.length}/${count} valid — retrying with recency=${recency}`,
        );
        await new Promise((r) => setTimeout(r, fetchRetryAttemptDelay));
      }

      const requestCount = remaining + fetchBuffer;
      const body = await this.callPerplexity(
        this.buildPayload(region, country, sources, requestCount, recency, i),
        logger,
      );
      logBody(body, recency);
      totalUsage = {
        prompt_tokens: totalUsage.prompt_tokens + body.usage.prompt_tokens,
        completion_tokens: totalUsage.completion_tokens + body.usage.completion_tokens,
        total_tokens: totalUsage.total_tokens + body.usage.total_tokens,
        cost: { total_cost: totalUsage.cost.total_cost + body.usage.cost.total_cost },
      };

      const result = await this.parseHeadlines(body, remaining, logger, usedUrls, usedSlugs, i);
      totalCandidatesGenerated += result.candidatesGenerated;
      totalUrlFilterDropCount += result.urlFilterDropCount;
      totalModelFallbackCount += result.modelFallbackCount;

      for (let j = 0; j < result.headlines.length; j++) {
        const h = result.headlines[j]!;
        const q = result.qualities[j]!;
        if (!isDuplicateTopic(h.title, collected)) {
          collected.push(h);
          allQualities.push(q);
        } else {
          logger.info(`[${region}] Duplicate topic dropped: "${h.title}"`);
          topicDropCount++;
        }
      }
    }

    const rankResult: RankingResult = await rankHeadlines(
      collected.slice(0, count),
      region,
      this.config,
    );
    const headlines = rankResult.headlines;
    const rankingUsage = rankResult.usage ?? undefined;

    const acceptedQualities = allQualities.slice(0, count);

    // ── og:image extraction — match one image per ranked headline ──
    // headlines is the ranked order; imageUrl is attached to each headline (persisted
    // via the digest payload) and mirrored onto the quality records (run log only) by URL.
    const ogImages = await fetchOgImages(headlines);
    const ogCounts: Record<ImageSource, number> = { og: 0, twitter: 0, none: 0, deduped: 0 };
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
        `(og:${ogCounts.og} twitter:${ogCounts.twitter} none:${ogCounts.none} deduped:${ogCounts.deduped})`,
    );

    const filterRejectRate =
      totalCandidatesGenerated > 0
        ? (totalUrlFilterDropCount + topicDropCount) / totalCandidatesGenerated
        : 0;
    const avgUrlMatchScore =
      acceptedQualities.length > 0
        ? acceptedQualities.reduce((s, h) => s + h.urlMatchScore, 0) / acceptedQualities.length
        : 0;

    const quality: DigestQuality = {
      region,
      country,
      status: headlines.length === 0 ? 'empty' : headlines.length < count ? 'partial' : 'ok',
      attemptsUsed: attempts,
      recenciesUsed,
      candidatesGenerated: totalCandidatesGenerated,
      urlFilterDropCount: totalUrlFilterDropCount,
      modelFallbackCount: totalModelFallbackCount,
      topicDropCount,
      filterRejectRate,
      avgUrlMatchScore,
      avgTopicSpread: calcAvgTopicSpread(headlines),
      headlines: acceptedQualities,
      usage: {
        promptTokens: totalUsage.prompt_tokens,
        completionTokens: totalUsage.completion_tokens,
        totalTokens: totalUsage.total_tokens,
        costUsd: totalUsage.cost.total_cost,
      },
    };

    logger.info(`Fetched ${headlines.length}/${count} headlines for ${region}`);
    return {
      region,
      headlines,
      attempts,
      quality,
      usage: {
        promptTokens: totalUsage.prompt_tokens,
        completionTokens: totalUsage.completion_tokens,
        totalTokens: totalUsage.total_tokens,
        costUsd: totalUsage.cost.total_cost,
      },
      rankingUsage,
    };
  }
}
