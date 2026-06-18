import { loadPulseConfig, createSource } from '../src/config';
import { persistDigests, persistGlobalDigest, buildClient, dispatchFcm } from '../src/notify';
import { rankGlobalHeadlines } from '../src/rankHeadlines';
import { getLogger, formatError } from '../src/logging';
import type { DigestUsage } from '../src/types';
import {
  buildRunLog,
  deduplicateAcrossDigests,
  runFetchPipeline,
  writeRunLog,
} from '../src/pipeline';
import {
  buildRunReport,
  formatRunReportSummary,
  persistRunReport,
  type NotifyOutcome,
} from '../src/runReport';

/**
 * GitHub Actions cron job (.github/workflows/daily-digest.yml) — fetch all
 * region digests, persist to DB, then push notifications to devices that have
 * no custom notify_at time set (null means "notify me when the digest is
 * ready"). Devices with a specific notify_at receive theirs via jobs/notify.ts,
 * which runs every 30 minutes.
 *
 * Run from cron/: `npx ts-node -r tsconfig-paths/register jobs/daily-digest.ts`
 */
async function main(): Promise<void> {
  const startTime = Date.now();
  const config = loadPulseConfig();
  const log = getLogger('daily-digest');
  const source = createSource(config);

  try {
    log.info(`Starting daily digest — ${config.api.regions.length} region(s) configured`);

    const {
      resolvedRegions,
      digests: fetchedDigests,
      errors,
    } = await runFetchPipeline(config, source);

    const digests = deduplicateAcrossDigests(fetchedDigests);

    errors.forEach((error) =>
      log.error(`Region fetch failed: ${error.region}: ${formatError(error.reason)}`),
    );

    if (digests.length === 0) {
      throw new Error('All region fetches failed');
    }

    await persistDigests(digests, config);

    let globalRankingUsage: DigestUsage | null = null;
    if (config.api.ranking.global.enabled) {
      const { headlines: globalHeadlines, usage } = await rankGlobalHeadlines(digests, config);
      globalRankingUsage = usage;

      if (globalHeadlines.length > 0) {
        await persistGlobalDigest(globalHeadlines);
      }
    }

    const db = buildClient();

    const { data: devices, error } = await db
      .from('devices')
      .select('fcm_token')
      .is('notify_at', null);

    let notify: NotifyOutcome = { devicesTargeted: 0, sent: 0, failed: 0 };
    if (error) {
      log.warn(`Failed to read null-notify_at devices: ${error.message}`);
    } else if (devices?.length) {
      const tokens = devices.map((d) => d.fcm_token as string);
      const regions = digests.map((d) => d.region).join(',');

      const result = await dispatchFcm(tokens, regions);
      notify = {
        devicesTargeted: result.total,
        sent: result.sent,
        failed: result.total - result.sent,
      };
    }

    const report = buildRunReport({
      config,
      resolvedRegions,
      digests,
      errors,
      startTime,
      globalRankingUsage,
      notify,
    });
    log.info(formatRunReportSummary(report));
    await persistRunReport(report);

    if (config.log.qualityLog) {
      const runLog = buildRunLog(config, resolvedRegions, digests, errors, startTime);
      const logPath = writeRunLog(runLog, resolvedRegions);
      log.info(`Quality log → ${logPath}`);
    }
  } catch (err) {
    log.error(`Unhandled error: ${formatError(err)}`);
    process.exit(1);
  }

  // firebase-admin / supabase keep sockets open — without an explicit exit the
  // Actions job would hang until its timeout after the work is done.
  process.exit(0);
}

void main();
