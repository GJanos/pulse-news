import * as Crypto from 'expo-crypto';

import { storage } from '../storage/mmkv';
import { DEVICE_ID_KEY, TOKEN_KEY } from './keys';
import { requestPushPermission, getFcmToken, onFcmTokenRefresh } from './fcm';
import { upsertDevice } from './devices';
import { getLogger } from '../logger';

const log = getLogger('register');

export interface DeviceRegistration {
  deviceId: string;
  fcmToken: string;
}

/** Returns this install's stable UUID; generates and persists on first call. */
export async function getOrCreateDeviceId(): Promise<string> {
  const existing = storage.getString(DEVICE_ID_KEY) ?? null;
  if (existing) {
    log.debug(`device ID: ${existing.slice(0, 8)}… (existing)`);
    return existing;
  }
  const uuid = Crypto.randomUUID();
  storage.set(DEVICE_ID_KEY, uuid);
  log.info(`new device ID generated: ${uuid.slice(0, 8)}…`);
  return uuid;
}

/**
 * Full registration flow. Idempotent — safe on every launch (so React
 * StrictMode double-invocation is harmless). Returns null when permission
 * is denied or no token is obtainable.
 */
export async function registerForPushNotifications(): Promise<DeviceRegistration | null> {
  log.info('registerForPushNotifications: starting');
  const deviceId = await getOrCreateDeviceId();

  const granted = await requestPushPermission();
  if (!granted) {
    log.warn('registration aborted — push permission denied');
    return null;
  }

  const fcmToken = await getFcmToken();
  if (!fcmToken) {
    log.warn('registration aborted — no FCM token available');
    return null;
  }

  const cachedToken = storage.getString(TOKEN_KEY) ?? null;
  if (cachedToken !== fcmToken) {
    log.info('FCM token changed — upserting device record');
    await persistToken(deviceId, fcmToken);
  } else {
    log.debug('FCM token unchanged — skipping upsert');
  }

  log.info(`registration complete: device=${deviceId.slice(0, 8)}…`);
  return { deviceId, fcmToken };
}

/** Upsert the device row and cache the token in MMKV — the single write path. */
async function persistToken(deviceId: string, token: string): Promise<void> {
  await upsertDevice({ deviceId, fcmToken: token });
  storage.set(TOKEN_KEY, token);
}

/** Re-upsert + re-cache when Firebase rotates the token. Returns unsubscribe. */
export function listenForTokenRefresh(deviceId: string): () => void {
  log.debug(`subscribed to FCM token-refresh events for device ${deviceId.slice(0, 8)}…`);
  return onFcmTokenRefresh(async (newToken: string) => {
    log.info(`FCM token refreshed for device ${deviceId.slice(0, 8)}… — re-upserting`);
    await persistToken(deviceId, newToken);
  });
}
