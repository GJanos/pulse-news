import { loadPulseConfig } from '../src/config';
import { sendDueNotifications } from '../src/notify';
import { getLogger, formatError } from '../src/logging';

/**
 * GitHub Actions cron job (.github/workflows/notify.yml) — notify devices whose
 * notify_at fell in (last_run_at, now]. The catch-up window means a device is
 * never dropped when the schedule fires irregularly; in the reliable every-30-min
 * case it matches the old fixed-window behaviour. Devices with notify_at = NULL
 * are handled by jobs/daily-digest.ts instead.
 *
 * Run from cron/: `npx ts-node -r tsconfig-paths/register jobs/notify.ts`
 */
async function main(): Promise<void> {
  loadPulseConfig();

  const log = getLogger('notify-cron');

  try {
    log.info('Starting due-notification run');
    const { sent, total } = await sendDueNotifications();
    log.info(`Sent ${sent}/${total} notifications`);
  } catch (err) {
    log.error(`Unhandled error: ${formatError(err)}`);
    process.exit(1);
  }

  // firebase-admin / supabase keep sockets open — without an explicit exit the
  // Actions job would hang until its timeout after the work is done.
  process.exit(0);
}

void main();
