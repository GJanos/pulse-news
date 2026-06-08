import type { IncomingMessage, ServerResponse } from 'http';

import { loadPulseConfig, createSource, checkCronSecret } from '../src/config';
import { persistDigests, persistGlobalDigest, buildClient, dispatchFcm } from '../src/notify';
import { rankGlobalHeadlines } from '../src/rankHeadlines';
import { getLogger } from '../src/logging';
import {
  buildRunLog,
  deduplicateAcrossDigests,
  runFetchPipeline,
  writeRunLog,
} from '../src/pipeline';

/**
 * Vercel cron handler — fetch all region digests, persist to DB, then push
 * notifications to devices that have no custom notify_at time set (null means
 * "notify me when the digest is ready").
 *
 * Devices with a specific notify_at time receive their notification via
 * /api/notify, which runs every 30 minutes.
 */
export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!checkCronSecret(req, res)) return;

  const startTime = Date.now();
  const config = loadPulseConfig();
  const log = getLogger('daily-digest');
  const source = createSource(config);

  try {
    const {
      resolvedRegions,
      digests: fetchedDigests,
      errors,
    } = await runFetchPipeline(config, source);
    const digests = deduplicateAcrossDigests(fetchedDigests);
    errors.forEach((error) =>
      log.error(`Region fetch failed: ${error.region}: ${String(error.reason)}`),
    );

    if (digests.length === 0) {
      log.error('All region fetches failed');
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'All region fetches failed' }));
      return;
    }

    await persistDigests(digests, config);

    if (config.api.ranking.global.enabled) {
      const globalHeadlines = await rankGlobalHeadlines(digests, config);
      if (globalHeadlines.length > 0) {
        await persistGlobalDigest(globalHeadlines);
      }
    }

    const db = buildClient();
    const { data: devices, error } = await db
      .from('devices')
      .select('fcm_token')
      .is('notify_at', null);
    if (error) {
      log.warn(`Failed to read null-notify_at devices: ${error.message}`);
    } else if (devices && devices.length > 0) {
      const tokens = devices.map((d) => d.fcm_token as string);
      const regions = digests.map((d) => d.region).join(',');
      await dispatchFcm(tokens, regions);
    } else {
      log.info('No null-notify_at devices to notify');
    }

    const totalTokens = digests.reduce((sum, d) => sum + (d.usage?.totalTokens ?? 0), 0);
    log.info(`Done — ${digests.length}/${resolvedRegions.length} regions, ${totalTokens} tokens`);

    if (config.log.qualityLog) {
      const runLog = buildRunLog(config, resolvedRegions, digests, startTime);
      const logPath = writeRunLog(runLog, resolvedRegions);
      log.info(`Quality log → ${logPath}`);
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, regions: digests.length }));
  } catch (err) {
    log.error(`Unhandled error: ${String(err)}`);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: String(err) }));
  }
}
