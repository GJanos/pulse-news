import type { PulseConfig } from '@shared/config';
import type { DigestUsage, RegionDigest, DigestQuality } from './types';
import type { RegionConfig } from './regions';
import type { RunConfig } from './qualityLog';
import { buildRunConfig } from './pipeline';
import { buildClient } from './notify';
import { formatError, getLogger } from './logging';

export interface UsageTotals {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
}

export interface NotifyOutcome {
  devicesTargeted: number;
  sent: number;
  failed: number;
}

/**
 * One complete, versioned record of a daily-digest pipeline run — the durable,
 * queryable companion to the human-readable log lines. Persisted to
 * `public.pipeline_runs` (see supabase/schema.sql). Bump `schema` on any
 * breaking shape change so downstream queries can branch on the version.
 */
export interface RunReport {
  schema: 'pulse.run.v1';
  runAt: string;
  status: 'ok' | 'partial';
  durationMs: number;
  runConfig: RunConfig;
  regions: { requested: string[]; succeeded: string[]; failed: string[] };
  cost: {
    fetch: UsageTotals;
    ranking: UsageTotals;
    total: { totalTokens: number; costUsd: number };
  };
  headlines: { requested: number; fetched: number };
  notify: NotifyOutcome;
  quality: DigestQuality[];
}

export interface BuildRunReportArgs {
  config: PulseConfig;
  resolvedRegions: RegionConfig[];
  digests: RegionDigest[];
  errors: Array<{ region: string; reason: unknown }>;
  startTime: number;
  /** Combined usage from the global-ranking step; null when it did not run. */
  globalRankingUsage: DigestUsage | null;
  notify: NotifyOutcome;
}

const ZERO: UsageTotals = { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: 0 };

/** Sum a list of usage records (skipping null/undefined) into a single total. */
function sumUsage(usages: Array<DigestUsage | null | undefined>): UsageTotals {
  return usages.reduce<UsageTotals>(
    (acc, u) =>
      u
        ? {
            promptTokens: acc.promptTokens + u.promptTokens,
            completionTokens: acc.completionTokens + u.completionTokens,
            totalTokens: acc.totalTokens + u.totalTokens,
            costUsd: acc.costUsd + u.costUsd,
          }
        : acc,
    { ...ZERO },
  );
}

/**
 * Assemble the complete run report. Pure — aggregates fetch cost, per-region
 * ranking cost and the global-ranking cost, partitions regions, and folds in
 * notify and headline counts.
 */
export function buildRunReport(args: BuildRunReportArgs): RunReport {
  const { config, resolvedRegions, digests, errors, startTime, globalRankingUsage, notify } = args;

  const fetch = sumUsage(digests.map((d) => d.usage));
  const ranking = sumUsage([...digests.map((d) => d.rankingUsage), globalRankingUsage]);

  return {
    schema: 'pulse.run.v1',
    runAt: new Date().toISOString(),
    status: errors.length > 0 ? 'partial' : 'ok',
    durationMs: Date.now() - startTime,
    runConfig: buildRunConfig(config),
    regions: {
      requested: resolvedRegions.map((r) => r.region),
      succeeded: digests.map((d) => d.region),
      failed: errors.map((e) => e.region),
    },
    cost: {
      fetch,
      ranking,
      total: {
        totalTokens: fetch.totalTokens + ranking.totalTokens,
        costUsd: fetch.costUsd + ranking.costUsd,
      },
    },
    headlines: {
      requested: resolvedRegions.length * config.api.fetch.count,
      fetched: digests.reduce((sum, d) => sum + d.headlines.length, 0),
    },
    notify,
    quality: digests.flatMap((d) => (d.quality ? [d.quality] : [])),
  };
}

/** Compact token count for log lines: 45231 → "45.2k". */
function formatTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

/**
 * One dense, human-readable summary line — meaningful at a glance, in the
 * spirit of the existing usageSummary. The structured RunReport carries the
 * queryable detail; this is the on-screen companion.
 */
export function formatRunReportSummary(report: RunReport): string {
  const { regions, headlines, cost, notify, status, durationMs } = report;
  return (
    `Run [${status}] — ${regions.succeeded.length}/${regions.requested.length} regions, ` +
    `${headlines.fetched} headlines | ` +
    `fetch $${cost.fetch.costUsd.toFixed(4)} (${formatTokens(cost.fetch.totalTokens)} tok) | ` +
    `ranking $${cost.ranking.costUsd.toFixed(4)} (${formatTokens(cost.ranking.totalTokens)} tok) | ` +
    `total $${cost.total.costUsd.toFixed(4)} | ` +
    `notify ${notify.sent}/${notify.devicesTargeted} | ` +
    `${(durationMs / 1000).toFixed(1)}s`
  );
}

/**
 * Persist one run report to `public.pipeline_runs` via the service-role client.
 * Observability must never break the product pipeline, so any failure here is
 * logged and swallowed — the digest run still counts as a success.
 */
export async function persistRunReport(report: RunReport): Promise<void> {
  const log = getLogger('run-report');
  try {
    const db = buildClient();
    const { error } = await db.from('pipeline_runs').insert({
      run_at: report.runAt,
      status: report.status,
      total_cost_usd: report.cost.total.costUsd,
      total_tokens: report.cost.total.totalTokens,
      regions_succeeded: report.regions.succeeded.length,
      regions_failed: report.regions.failed.length,
      duration_ms: report.durationMs,
      report,
    });
    if (error) {
      log.warn(`Failed to persist run report: ${error.message}`);
      return;
    }
    log.info('Run report persisted to pipeline_runs');
  } catch (err) {
    log.warn(`Failed to persist run report: ${formatError(err)}`);
  }
}
