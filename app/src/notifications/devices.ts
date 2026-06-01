import { getSupabase } from '../supabase/client';
import { storage } from '../storage/mmkv';
import { TOKEN_KEY } from './keys';
import { getLogger } from '../logger';

const log = getLogger('devices');

interface UpsertParams {
  deviceId: string;
  fcmToken: string;
  notifyAt?: string | null; // "HH:MM" or null
}

/**
 * Upsert (id, fcm_token, updated_at) into the Supabase `devices` table,
 * adding notify_at only when provided. No-op when Supabase is unconfigured.
 * Uses the publishable key — allowed by the INSERT/UPDATE RLS policies.
 */
export async function upsertDevice({ deviceId, fcmToken, notifyAt }: UpsertParams): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) {
    log.debug('upsertDevice skipped — Supabase not configured');
    return;
  }
  log.info(
    `upserting device ${deviceId.slice(0, 8)}…${notifyAt !== undefined ? ` (notify_at=${notifyAt ?? 'null'})` : ''}`,
  );
  const payload: Record<string, unknown> = {
    id: deviceId,
    fcm_token: fcmToken,
    updated_at: new Date().toISOString(),
  };
  if (notifyAt !== undefined) payload['notify_at'] = notifyAt;

  const { error } = await supabase.from('devices').upsert(payload, { onConflict: 'id' });
  if (error) log.warn(`upsertDevice failed: ${error.message}`);
  else log.debug(`device ${deviceId.slice(0, 8)}… upserted successfully`);
}

/** Associate this device with the authenticated user. No-op when unconfigured. */
export async function linkDeviceToUser(deviceId: string, userId: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  const { error } = await supabase.from('devices').update({ user_id: userId }).eq('id', deviceId);
  if (error) log.warn(`linkDeviceToUser failed: ${error.message}`);
  else log.info(`device ${deviceId.slice(0, 8)}… linked to user ${userId.slice(0, 8)}…`);
}

/**
 * Update only this device's notify_at column. Reads the cached FCM token;
 * skips when the device has not registered yet (no token to anchor the row).
 */
export async function updateNotifyTime(deviceId: string, notifyAt: string | null): Promise<void> {
  const cachedToken = storage.getString(TOKEN_KEY) ?? null;
  if (!cachedToken) {
    log.debug('updateNotifyTime: no cached token — device not yet registered, skipping');
    return;
  }
  log.info(`updating notify_at → ${notifyAt ?? 'null'} for device ${deviceId.slice(0, 8)}…`);
  await upsertDevice({ deviceId, fcmToken: cachedToken, notifyAt });
}
