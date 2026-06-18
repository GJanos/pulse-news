// cron/src/rankHeadlines.ts
import Anthropic from '@anthropic-ai/sdk';
import type { RegionHeadline, RegionDigest, DigestUsage } from './types';
import type { PulseConfig } from '@shared/config';
import {
  buildRankingSystemPrompt,
  buildRankingUserPrompt,
  buildGlobalSystemPrompt,
  buildGlobalUserPrompt,
} from './prompt';
import { getLogger } from './logging';

// Lazily initialized after dotenv runs — avoids re-instantiation per region call.
let _client: Anthropic | null = null;
function getClient(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  if (!_client) _client = new Anthropic({ apiKey });
  return _client;
}

// Sonnet pricing as of 2026 — update here if Anthropic changes rates.
const COST_PER_INPUT_TOKEN = 3.0 / 1_000_000;
const COST_PER_OUTPUT_TOKEN = 15.0 / 1_000_000;

const RANKING_TOOL: Anthropic.Tool = {
  name: 'submit_ranking',
  description: 'Submit the ranked order of headlines, most important first.',
  input_schema: {
    type: 'object',
    properties: {
      ranking: {
        type: 'array',
        items: { type: 'integer' },
        description:
          '1-based headline indices in descending order of importance. Must contain every index exactly once.',
      },
    },
    required: ['ranking'],
  },
};

const GLOBAL_TOOL: Anthropic.Tool = {
  name: 'submit_global_selection',
  description: 'Submit the indices of the most globally important headlines, most important first.',
  input_schema: {
    type: 'object',
    properties: {
      indices: {
        type: 'array',
        items: { type: 'integer' },
        description: '1-based headline indices in descending order of global importance.',
      },
    },
    required: ['indices'],
  },
};

export interface GlobalHeadline {
  title: string;
  summary: string;
  detail?: string;
  url: string;
  region: string;
  sourceName?: string;
  /** og:image URL matched for the source headline; persisted in the global digest payload. */
  imageUrl?: string;
}

export interface RankingResult {
  headlines: RegionHeadline[];
  usage: DigestUsage | null;
}

export interface GlobalRankingResult {
  headlines: GlobalHeadline[];
  /** Combined usage across every Claude pass (round 1 chunks + round 2). Null when no call was made. */
  usage: DigestUsage | null;
}

/** Sum a list of usage records into one. Returns null when the list is empty. */
function sumUsages(usages: DigestUsage[]): DigestUsage | null {
  if (usages.length === 0) return null;
  return usages.reduce((acc, u) => ({
    promptTokens: acc.promptTokens + u.promptTokens,
    completionTokens: acc.completionTokens + u.completionTokens,
    totalTokens: acc.totalTokens + u.totalTokens,
    costUsd: acc.costUsd + u.costUsd,
  }));
}

/**
 * Reorders headlines by country importance using Claude.
 * Falls back to original order if the ranking call fails or returns an invalid result.
 */
export async function rankHeadlines(
  headlines: RegionHeadline[],
  region: string,
  config: PulseConfig,
): Promise<RankingResult> {
  if (!config.api.ranking.local.enabled || headlines.length <= 1) {
    return { headlines, usage: null };
  }

  const log = getLogger('rankHeadlines');
  const client = getClient();
  if (!client) {
    log.warn('ANTHROPIC_API_KEY not set — skipping ranking');
    return { headlines, usage: null };
  }

  const { model, maxTokens } = config.api.ranking.local;

  try {
    const response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      system: buildRankingSystemPrompt(),
      messages: [
        {
          role: 'user',
          content: buildRankingUserPrompt(
            region,
            headlines.map((h) => ({ title: h.title, summary: h.summary ?? '' })),
          ),
        },
      ],
      tools: [RANKING_TOOL],
      tool_choice: { type: 'any' },
    });

    const { input_tokens, output_tokens } = response.usage;
    const costUsd = input_tokens * COST_PER_INPUT_TOKEN + output_tokens * COST_PER_OUTPUT_TOKEN;
    const usage: DigestUsage = {
      promptTokens: input_tokens,
      completionTokens: output_tokens,
      totalTokens: input_tokens + output_tokens,
      costUsd,
    };
    log.info(
      `[${region}] ranking — ${input_tokens}+${output_tokens}=${usage.totalTokens} tokens | $${costUsd.toFixed(6)}`,
    );

    const toolUse = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
    );
    if (!toolUse) throw new Error('No tool_use block in response');

    const input = toolUse.input as { ranking: unknown };
    if (!Array.isArray(input.ranking)) throw new Error('ranking is not an array');

    const indices = input.ranking as number[];
    if (indices.length !== headlines.length) {
      throw new Error(`Expected ${headlines.length} indices, got ${indices.length}`);
    }

    const seen = new Set<number>();
    for (const idx of indices) {
      if (!Number.isInteger(idx) || idx < 1 || idx > headlines.length) {
        throw new Error(`Invalid index ${idx}`);
      }
      if (seen.has(idx)) throw new Error(`Duplicate index ${idx}`);
      seen.add(idx);
    }

    log.info(`[${region}] Ranked: ${indices.join(' > ')}`);
    return { headlines: indices.map((i) => headlines[i - 1]!), usage };
  } catch (err) {
    log.warn(
      `[${region}] Ranking failed (${err instanceof Error ? err.message : String(err)}) — using original order`,
    );
    return { headlines, usage: null };
  }
}

type Candidate = {
  region: string;
  title: string;
  summary: string;
  detail?: string;
  url: string;
  sourceName?: string;
  imageUrl?: string;
};

async function globalRankingPass(
  client: Anthropic,
  candidates: Candidate[],
  count: number,
  model: string,
  maxTokens: number,
): Promise<{ headlines: GlobalHeadline[]; usage: DigestUsage }> {
  const log = getLogger('rankHeadlines');
  const actualCount = Math.min(count, candidates.length);

  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system: buildGlobalSystemPrompt(),
    messages: [{ role: 'user', content: buildGlobalUserPrompt(candidates, actualCount) }],
    tools: [GLOBAL_TOOL],
    tool_choice: { type: 'any' },
  });

  const { input_tokens, output_tokens } = response.usage;
  const costUsd = input_tokens * COST_PER_INPUT_TOKEN + output_tokens * COST_PER_OUTPUT_TOKEN;
  const usage: DigestUsage = {
    promptTokens: input_tokens,
    completionTokens: output_tokens,
    totalTokens: input_tokens + output_tokens,
    costUsd,
  };
  log.info(
    `Global pass — ${candidates.length} candidates → ${actualCount} — ${input_tokens}+${output_tokens} tokens | $${costUsd.toFixed(6)}`,
  );

  const toolUse = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
  if (!toolUse) throw new Error('No tool_use block in response');

  const input = toolUse.input as { indices: unknown };
  if (!Array.isArray(input.indices)) throw new Error('indices is not an array');

  const indices = input.indices as number[];
  if (indices.length !== actualCount) {
    throw new Error(`Expected ${actualCount} indices, got ${indices.length}`);
  }

  const seen = new Set<number>();
  for (const idx of indices) {
    if (!Number.isInteger(idx) || idx < 1 || idx > candidates.length) {
      throw new Error(`Invalid index ${idx}`);
    }
    if (seen.has(idx)) throw new Error(`Duplicate index ${idx}`);
    seen.add(idx);
  }

  const headlines = indices.map((i) => {
    const c = candidates[i - 1]!;
    return {
      title: c.title,
      summary: c.summary,
      detail: c.detail,
      url: c.url,
      region: c.region,
      sourceName: c.sourceName,
      imageUrl: c.imageUrl,
    };
  });
  return { headlines, usage };
}

/**
 * Selects the top globally important headlines across all region digests using Claude.
 * When candidates exceed chunkSize, uses a two-round approach: round 1 scores each
 * chunk in parallel and collects survivors; round 2 picks the final set from survivors.
 * Returns an empty array if disabled, no candidates exist, or the Claude call fails.
 */
export async function rankGlobalHeadlines(
  digests: RegionDigest[],
  config: PulseConfig,
): Promise<GlobalRankingResult> {
  const { enabled, count, model, maxTokens, chunkSize } = config.api.ranking.global;
  if (!enabled) return { headlines: [], usage: null };

  const log = getLogger('rankHeadlines');
  const candidates: Candidate[] = digests.flatMap((d) =>
    d.headlines.map((h) => ({
      region: d.region,
      title: h.title,
      summary: h.summary ?? '',
      detail: h.detail,
      url: h.url,
      sourceName: h.sourceName,
      imageUrl: h.imageUrl,
    })),
  );
  if (candidates.length === 0) return { headlines: [], usage: null };

  const client = getClient();
  if (!client) {
    log.warn('ANTHROPIC_API_KEY not set — skipping global ranking');
    return { headlines: [], usage: null };
  }

  const actualCount = Math.min(count, candidates.length);

  try {
    if (candidates.length <= chunkSize) {
      const pass = await globalRankingPass(client, candidates, actualCount, model, maxTokens);
      log.info(`Global ranked: ${pass.headlines.map((h) => h.region).join(' > ')}`);
      return { headlines: pass.headlines, usage: pass.usage };
    }

    const chunks: Candidate[][] = [];
    for (let i = 0; i < candidates.length; i += chunkSize) {
      chunks.push(candidates.slice(i, i + chunkSize));
    }
    const survivorsPerChunk = Math.max(
      3,
      Math.min(Math.ceil((actualCount * 2) / chunks.length), Math.floor(chunkSize / chunks.length)),
    );
    log.info(
      `Global ranking round 1: ${candidates.length} candidates → ${chunks.length} chunks, keeping ${survivorsPerChunk} each`,
    );

    const survivorPasses = await Promise.all(
      chunks.map((ch) =>
        globalRankingPass(client, ch, Math.min(survivorsPerChunk, ch.length), model, maxTokens),
      ),
    );
    const survivors = survivorPasses.flatMap((p) => p.headlines);

    log.info(`Global ranking round 2: ${survivors.length} survivors → ${actualCount} final`);
    const finalPass = await globalRankingPass(client, survivors, actualCount, model, maxTokens);
    log.info(`Global ranked: ${finalPass.headlines.map((h) => h.region).join(' > ')}`);

    const usage = sumUsages([...survivorPasses.map((p) => p.usage), finalPass.usage]);
    return { headlines: finalPass.headlines, usage };
  } catch (err) {
    log.warn(
      `Global ranking failed (${err instanceof Error ? err.message : String(err)}) — skipping global section`,
    );
    return { headlines: [], usage: null };
  }
}
