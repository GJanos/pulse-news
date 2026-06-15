import '../src/bootstrap';
import { loadPulseConfig } from '../src/config';
import { getLogger } from '../src/logging';
import { buildClient } from '../src/notify';

const log = getLogger('e2e:notifyWindows');

// Fixed UUIDs + token prefix so cleanup can target exactly these rows.
const PREFIX = 'e2e-notify-';
const DEV_A = '00000000-0000-4000-8000-0000000000a1'; // notify_at in-window
const DEV_B = '00000000-0000-4000-8000-0000000000b2'; // notify_at out-of-window

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** UTC HH:MM:SS string `offsetMin` minutes from `base`. */
function utcTime(base: Date, offsetMin: number): string {
  const d = new Date(base.getTime() + offsetMin * 60_000);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

async function main(): Promise<void> {
  loadPulseConfig();
  const db = buildClient();

  // Snapshot last_run_at so we can restore it after the destructive claim test.
  const { data: snap, error: snapErr } = await db
    .from('notify_state')
    .select('last_run_at')
    .eq('id', true)
    .single();
  if (snapErr) throw new Error(`Failed to read notify_state: ${snapErr.message}`);
  const savedLastRun = snap!.last_run_at as string;
  log.info(`Saved last_run_at = ${savedLastRun}`);

  let failures = 0;
  const check = (name: string, ok: boolean) => {
    log.info(`${ok ? 'PASS' : 'FAIL'} — ${name}`);
    if (!ok) failures += 1;
  };

  try {
    const now = new Date();

    // Device A: notify_at 5 min ago (inside a (last_run, now] window that
    // starts 30 min ago). Device B: notify_at 5 min in the future (outside).
    await db.from('devices').upsert([
      { id: DEV_A, fcm_token: `${PREFIX}a`, notify_at: utcTime(now, -5) },
      { id: DEV_B, fcm_token: `${PREFIX}b`, notify_at: utcTime(now, +5) },
    ]);

    // Set last_run_at to 30 min ago: A's time is inside (last_run, now], B's is not.
    await db
      .from('notify_state')
      .update({ last_run_at: new Date(now.getTime() - 30 * 60_000).toISOString() })
      .eq('id', true);

    // peek must report due (A qualifies).
    const { data: peek, error: peekErr } = await db.rpc('peek_due_notifications');
    if (peekErr) throw new Error(`peek failed: ${peekErr.message}`);
    check('normal window: peek returns true when a device is due', peek === true);

    // claim returns A's token (not B's) and advances last_run_at.
    const { data: claimed, error: claimErr } = await db.rpc('claim_due_notifications');
    if (claimErr) throw new Error(`claim failed: ${claimErr.message}`);
    const tokens = ((claimed ?? []) as Array<{ fcm_token: string }>).map((r) => r.fcm_token);
    check('normal window: claim returns the in-window device', tokens.includes(`${PREFIX}a`));
    check('normal window: claim excludes the out-of-window device', !tokens.includes(`${PREFIX}b`));

    // After claim, last_run_at advanced to ~now, so the same A is no longer due.
    const { data: peek2, error: peek2Err } = await db.rpc('peek_due_notifications');
    if (peek2Err) throw new Error(`peek2 failed: ${peek2Err.message}`);
    check('idempotency: peek returns false immediately after claim', peek2 === false);

    // >24h outage: last_run far in the past → every device is due once.
    await db
      .from('notify_state')
      .update({ last_run_at: new Date(now.getTime() - 48 * 3600 * 1000).toISOString() })
      .eq('id', true);
    const { data: claimedAll, error: allErr } = await db.rpc('claim_due_notifications');
    if (allErr) throw new Error(`claim (outage) failed: ${allErr.message}`);
    const allTokens = ((claimedAll ?? []) as Array<{ fcm_token: string }>).map((r) => r.fcm_token);
    check(
      '>24h outage: both test devices are claimed',
      allTokens.includes(`${PREFIX}a`) && allTokens.includes(`${PREFIX}b`),
    );
  } finally {
    // Cleanup: remove test devices and restore the original last_run_at.
    await db.from('devices').delete().in('id', [DEV_A, DEV_B]);
    await db.from('notify_state').update({ last_run_at: savedLastRun }).eq('id', true);
    log.info(`Restored last_run_at = ${savedLastRun}; removed test devices`);
  }

  if (failures > 0) {
    log.error(`${failures} check(s) failed`);
    process.exit(1);
  }
  log.info('All notify-window checks passed');
  process.exit(0);
}

main().catch((err) => {
  log.error(String(err));
  process.exit(1);
});
