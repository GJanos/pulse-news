import type { RegionConfig } from './regions';
import { resolveRegions } from './regions';
import type { PulseConfig } from '@shared/config';
import type { DigestSource, RegionDigest } from './types';
import type { RunConfig, RunLog } from './qualityLog';
import { appendRunLog, buildLogPath } from './qualityLog';

export interface FetchPipelineResult {
  resolvedRegions: RegionConfig[];
  digests: RegionDigest[];
  errors: Array<{ region: string; reason: unknown }>;
  totalDurationMs: number;
}

export function buildRunConfig(config: PulseConfig): RunConfig {
  return {
    model: config.model.name,
    reasoningEffort: config.model.reasoningEffort,
    temperature: config.model.temperature,
    searchType: config.model.searchType,
    searchContextSize: config.model.searchContextSize,
    summarySentences: config.api.fetch.summarySentences,
    detailSentences: config.api.fetch.detailSentences,
    maxFetchAttempts: config.api.fetch.maxAttempts,
    minFetchResults: config.api.fetch.minResults,
    fetchBuffer: config.api.fetch.buffer,
  };
}

export function buildRunLog(
  config: PulseConfig,
  resolvedRegions: RegionConfig[],
  digests: RegionDigest[],
  startTime: number,
): RunLog {
  const runConfig = buildRunConfig(config);
  return {
    runAt: new Date().toISOString(),
    runConfig,
    regions: resolvedRegions.map((r) => r.region),
    digests: digests.flatMap((d) => (d.quality ? [d.quality] : [])),
    totals: {
      promptTokens: digests.reduce((sum, d) => sum + (d.usage?.promptTokens ?? 0), 0),
      completionTokens: digests.reduce((sum, d) => sum + (d.usage?.completionTokens ?? 0), 0),
      totalTokens: digests.reduce((sum, d) => sum + (d.usage?.totalTokens ?? 0), 0),
      costUsd: digests.reduce((sum, d) => sum + (d.usage?.costUsd ?? 0), 0),
      headlinesFetched: digests.reduce((sum, d) => sum + d.headlines.length, 0),
      headlinesRequested: resolvedRegions.length * config.api.fetch.count,
      durationMs: Date.now() - startTime,
    },
  };
}

export function usageSummary(digests: RegionDigest[], totalRegions: number): string {
  const fetchTokens = digests.reduce((sum, d) => sum + (d.usage?.totalTokens ?? 0), 0);
  const fetchCost = digests.reduce((sum, d) => sum + (d.usage?.costUsd ?? 0), 0);
  const rankingTokens = digests.reduce((sum, d) => sum + (d.rankingUsage?.totalTokens ?? 0), 0);
  const rankingCost = digests.reduce((sum, d) => sum + (d.rankingUsage?.costUsd ?? 0), 0);
  return (
    `Fetch complete — ${digests.length}/${totalRegions} regions | ` +
    `fetch: ${fetchTokens} tokens $${fetchCost.toFixed(4)} | ` +
    `ranking: ${rankingTokens} tokens $${rankingCost.toFixed(4)} | ` +
    `total: $${(fetchCost + rankingCost).toFixed(4)}`
  );
}

export function retrySummary(digests: RegionDigest[]): string {
  return digests.map((d) => `${d.region}:${d.attempts}:${d.headlines.length}`).join(' | ');
}

export async function runFetchPipeline(
  config: PulseConfig,
  source: DigestSource,
): Promise<FetchPipelineResult> {
  const startTime = Date.now();
  const resolvedRegions = resolveRegions(config.api.regions);
  const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

  const results = await Promise.allSettled(
    resolvedRegions.map((region, index) =>
      delay(index * config.api.fetch.attemptDelay).then(() =>
        source.fetchDigest({ ...region, count: config.api.fetch.count }),
      ),
    ),
  );

  const digests = results.flatMap((result) =>
    result.status === 'fulfilled' ? [result.value] : [],
  );

  const errors = results
    .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    .map((result, index) => ({ region: resolvedRegions[index]!.region, reason: result.reason }));

  return {
    resolvedRegions,
    digests,
    errors,
    totalDurationMs: Date.now() - startTime,
  };
}

export function writeRunLog(log: RunLog, resolvedRegions: RegionConfig[]): string {
  const logPath = buildLogPath(
    log.runConfig,
    resolvedRegions.map((r) => r.country),
  );
  appendRunLog(log, logPath);
  return logPath;
}

/**
 * Nulls out imageUrls that appear in more than one region's headlines.
 * Per-region deduplication (in fetchOgImages) handles same-URL repetition
 * within a single region; this step catches publisher default images that
 * survived per-region dedup by appearing exactly once in each of several
 * regions' batches.
 */
export function deduplicateAcrossDigests(digests: RegionDigest[]): RegionDigest[] {
  const urlCount = new Map<string, number>();
  for (const d of digests) {
    for (const h of d.headlines) {
      if (h.imageUrl) urlCount.set(h.imageUrl, (urlCount.get(h.imageUrl) ?? 0) + 1);
    }
  }
  return digests.map((d) => ({
    ...d,
    headlines: d.headlines.map((h) =>
      h.imageUrl && (urlCount.get(h.imageUrl) ?? 0) > 1 ? { ...h, imageUrl: undefined } : h,
    ),
  }));
}
