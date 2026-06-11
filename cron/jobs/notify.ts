import { loadPulseConfig } from '../src/config';
import { buildClient, dispatchFcm } from '../src/notify';
import { getLogger } from '../src/logging';
import { notifyWindow } from '../src/lib/notifyWindow';

/**
 * GitHub Actions cron job (.github/workflows/notify.yml) — send push
 * notifications to devices whose notify_at falls in the current 30-minute
 * window. Runs every 30 minutes; most invocations send 0 notifications.
 * Devices with notify_at = NULL are handled by jobs/daily-digest.ts instead.
 *
 * Run from cron/: `npx ts-node -r tsconfig-paths/register jobs/notify.ts`
 */
async function main(): Promise<void> {
  loadPulseConfig();

  const log = getLogger('notify-cron');

  try {
    const { start, end } = notifyWindow();

    log.info(`Notify window ${start} – ${end}`);

    const db = buildClient();

    const { data: devices, error } = await db
      .from('devices')
      .select('fcm_token')
      .not('notify_at', 'is', null)
      .gte('notify_at', start)
      .lt('notify_at', end);

    if (error) {
      throw new Error(`Failed to read devices: ${error.message}`);
    }

    if (!devices?.length) {
      log.info('No devices in this window');
    } else {
      const tokens = devices.map((d) => d.fcm_token as string);
      const { sent, total } = await dispatchFcm(tokens);
      log.info(`Sent ${sent}/${total} notifications`);
    }
  } catch (err) {
    log.error(`Unhandled error: ${String(err)}`);
    process.exit(1);
  }

  // firebase-admin / supabase keep sockets open — without an explicit exit the
  // Actions job would hang until its timeout after the work is done.
  process.exit(0);
}

void main();
