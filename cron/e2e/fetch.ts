import '../src/bootstrap';
import { createSource, loadPulseConfig } from '../src/config';
import { getLogger } from '../src/logging';
import { rankGlobalHeadlines } from '../src/rankHeadlines';
import { buildRunLog, runFetchPipeline, writeRunLog } from '../src/pipeline';
import { printGlobalHeadlines, printHeadlines, printTotals } from './print';

type UsageTotals = { prompt: number; completion: number; tokens: number; cost: number };
type RetryStats = { region: string; attempts: number; got: number };

const log = getLogger('e2e:fetch');

async function main() {
  const startTime = Date.now();
  const config = loadPulseConfig();
  const source = createSource(config);

  const { resolvedRegions, digests, errors } = await runFetchPipeline(config, source);

  const fetchUsage: UsageTotals = { prompt: 0, completion: 0, tokens: 0, cost: 0 };
  const rankingUsage: UsageTotals = { prompt: 0, completion: 0, tokens: 0, cost: 0 };
  const retryStats: RetryStats[] = [];

  errors.forEach((error) =>
    log.error(`Region fetch failed: ${error.region}: ${String(error.reason)}`),
  );

  for (const digest of digests) {
    retryStats.push({
      region: digest.region,
      attempts: digest.attempts,
      got: digest.headlines.length,
    });
    printHeadlines(digest);
    if (digest.usage) {
      fetchUsage.prompt += digest.usage.promptTokens;
      fetchUsage.completion += digest.usage.completionTokens;
      fetchUsage.tokens += digest.usage.totalTokens;
      fetchUsage.cost += digest.usage.costUsd;
    }
    if (digest.rankingUsage) {
      rankingUsage.prompt += digest.rankingUsage.promptTokens;
      rankingUsage.completion += digest.rankingUsage.completionTokens;
      rankingUsage.tokens += digest.rankingUsage.totalTokens;
      rankingUsage.cost += digest.rankingUsage.costUsd;
    }
  }

  printTotals(retryStats, resolvedRegions.length, fetchUsage, rankingUsage, config.api.fetch.count);

  if (config.api.ranking.global.enabled) {
    const { headlines: globalHeadlines } = await rankGlobalHeadlines(digests, config);
    printGlobalHeadlines(globalHeadlines);
  }

  if (config.log.qualityLog) {
    const runLog = buildRunLog(config, resolvedRegions, digests, errors, startTime);
    const logPath = writeRunLog(runLog, resolvedRegions);
    log.info(`Quality log → ${logPath}`);
  }
}

main().catch((err) => {
  log.error(String(err));
  process.exit(1);
});
