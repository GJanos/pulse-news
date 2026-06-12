import { getSupabase } from '../supabase/client';
import { storage } from '../storage/mmkv';
import { TOKEN_KEY } from './keys';
import { getLogger } from '../logger';

const log = getLogger('devices');

interface UpsertParams {
  deviceId: string;
  fcmToken: string;
}

/**
 * Register (or refresh) this device via the `register_device` RPC. The RPC upserts
 * by the stable per-install id and evicts any other row that already holds this FCM
 * token (a reinstall ghost — the per-install id is regenerated but the token survives),
 * so one physical device can never accumulate duplicate rows. No-op when Supabase is
 * unconfigured. Uses the publishable key — granted EXECUTE on the RPC.
 *
 * notify_at is intentionally not passed: it is owned by updateNotifyTime, and
 * registration must never clobber it. p_user_id is likewise omitted — linkDeviceToUser
 * stamps the auth link after login.
 */
export async function upsertDevice({ deviceId, fcmToken }: UpsertParams): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) {
    log.debug('upsertDevice skipped — Supabase not configured');
    return false;
  }
  log.info(`registering device ${deviceId.slice(0, 8)}…`);
  const { error } = await supabase.rpc('register_device', {
    p_id: deviceId,
    p_token: fcmToken,
  });
  if (error) {
    log.warn(`upsertDevice failed: ${error.message}`);
    return false;
  }
  log.debug(`device ${deviceId.slice(0, 8)}… registered successfully`);
  return true;
}

/**
 * Associate this device with the authenticated user. Retries up to 3 times on a
 * 0-row result (the device row may not yet exist on first install if upsertDevice
 * is still in-flight when the auth event fires). Gives up immediately on a DB error.
 * No-op when unconfigured.
 */
export async function linkDeviceToUser(deviceId: string, userId: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;

  const MAX_ATTEMPTS = 3;
  const RETRY_DELAY_MS = 2000;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const { data, error } = await supabase
      .from('devices')
      .update({ user_id: userId })
      .eq('id', deviceId)
      .select('id');

    if (error) {
      log.warn(`linkDeviceToUser failed: ${error.message}`);
      return;
    }
    if (data && data.length > 0) {
      log.info(`device ${deviceId.slice(0, 8)}… linked to user ${userId.slice(0, 8)}…`);
      return;
    }
    if (attempt < MAX_ATTEMPTS) {
      log.debug(
        `linkDeviceToUser: 0-row update (attempt ${attempt}/${MAX_ATTEMPTS}) — device row not yet present, retrying in ${RETRY_DELAY_MS}ms`,
      );
      await new Promise<void>((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }
  }
  log.warn(
    `linkDeviceToUser: no device row for ${deviceId.slice(0, 8)}… after ${MAX_ATTEMPTS} attempts — not linked (device may not have registered yet)`,
  );
}

/**
 * Update only this device's notify_at column via a direct UPDATE (the publishable
 * key's `UPDATE … USING(true)` policy permits it). No id/token change, so no
 * reinstall-ghost eviction is needed — that is why this no longer routes through
 * registration. `notifyAt = null` ("notify at default cron time") is written
 * explicitly here; registration never touches this column.
 *
 * Skips when no FCM token is cached (device not registered yet). A cached token does
 * not guarantee the row exists — a prior registration RPC may have failed — so, like
 * linkDeviceToUser, this `.select('id')`s the affected row and warns on a 0-row update
 * instead of logging false success.
 */
export async function updateNotifyTime(deviceId: string, notifyAt: string | null): Promise<void> {
  const cachedToken = storage.getString(TOKEN_KEY) ?? null;
  if (!cachedToken) {
    log.debug('updateNotifyTime: no cached token — device not yet registered, skipping');
    return;
  }
  const supabase = getSupabase();
  if (!supabase) return;
  log.info(`updating notify_at → ${notifyAt ?? 'null'} for device ${deviceId.slice(0, 8)}…`);
  const { data, error } = await supabase
    .from('devices')
    .update({ notify_at: notifyAt, updated_at: new Date().toISOString() })
    .eq('id', deviceId)
    .select('id');
  if (error) {
    log.warn(`updateNotifyTime failed: ${error.message}`);
  } else if (!data || data.length === 0) {
    log.warn(
      `updateNotifyTime: no device row for ${deviceId.slice(0, 8)}… — notify_at not saved (device may not have registered yet)`,
    );
  } else {
    log.debug(`notify_at updated for device ${deviceId.slice(0, 8)}…`);
  }
}
