import '../src/bootstrap';
import { createSource, loadPulseConfig } from '../src/config';
import { getLogger } from '../src/logging';
import { persistDigests, persistGlobalDigest, sendNotifications } from '../src/notify';
import {
  buildRunLog,
  runFetchPipeline,
  retrySummary,
  usageSummary,
  writeRunLog,
} from '../src/pipeline';
import { rankGlobalHeadlines } from '../src/rankHeadlines';

const logger = getLogger('e2e:full');

async function main() {
  const startTime = Date.now();
  const config = loadPulseConfig();
  const source = createSource(config);

  const { resolvedRegions, digests, errors } = await runFetchPipeline(config, source);
  errors.forEach((error) =>
    logger.error(`Region fetch failed: ${error.region}: ${String(error.reason)}`),
  );

  if (digests.length === 0) {
    logger.error('All region fetches failed — skipping persist and notify');
    process.exit(1);
  }

  logger.info(usageSummary(digests, resolvedRegions.length));
  logger.info(`Attempts per region — ${retrySummary(digests)}`);

  await persistDigests(digests, config);

  if (config.api.ranking.global.enabled) {
    const { headlines: globalHeadlines } = await rankGlobalHeadlines(digests, config);
    if (globalHeadlines.length > 0) {
      await persistGlobalDigest(globalHeadlines);
    }
  }

  await sendNotifications(digests);

  if (config.log.qualityLog) {
    const log = buildRunLog(config, resolvedRegions, digests, errors, startTime);
    const logPath = writeRunLog(log, resolvedRegions);
    logger.info(`Quality log → ${logPath}`);
  }
}

main().catch((err) => {
  logger.error(String(err));
  process.exit(1);
});
