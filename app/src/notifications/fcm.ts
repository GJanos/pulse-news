import {
  getMessaging,
  getToken,
  requestPermission,
  hasPermission,
  onTokenRefresh,
  onNotificationOpenedApp,
  onMessage,
  getInitialNotification,
  AuthorizationStatus,
} from '@react-native-firebase/messaging';
import {
  setBadgeCountAsync,
  setNotificationChannelAsync,
  AndroidImportance,
} from 'expo-notifications';
import { Platform } from 'react-native';

import { DAILY_DIGEST_TYPE } from './keys';
import { getLogger } from '../logger';

const fcm = getMessaging();
const log = getLogger('fcm');

/**
 * Android channel id the cron's pushes target (`android.notification.channelId`
 * in cron/src/notify.ts). Must match exactly or Android 8+ drops the push onto
 * a silent fallback channel.
 */
export const DEFAULT_CHANNEL_ID = 'default';

/**
 * Create the Android notification channel the daily-digest pushes target. The
 * cron sends `channelId: 'default'`; without a matching channel Android 8+ posts
 * the notification to an auto-created low-importance fallback (no heads-up, no
 * sound), which is the leading cause of "missed" digests. HIGH importance + sound
 * restores the heads-up banner and alert. No-op off Android; idempotent — safe to
 * call on every launch (re-creating an existing channel is a cheap merge).
 */
export async function ensureDefaultChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    await setNotificationChannelAsync(DEFAULT_CHANNEL_ID, {
      name: 'Daily digest',
      importance: AndroidImportance.HIGH,
      sound: 'default',
      enableVibrate: true,
      vibrationPattern: [0, 250, 250, 250],
    });
    log.debug('default notification channel ensured');
  } catch (e: unknown) {
    log.warn(`ensureDefaultChannel failed: ${String(e)}`);
  }
}

function isGranted(status: number): boolean {
  return status === AuthorizationStatus.AUTHORIZED || status === AuthorizationStatus.PROVISIONAL;
}

async function clearNotificationBadge(): Promise<void> {
  try {
    await setBadgeCountAsync(0);
    log.debug('notification badge cleared');
  } catch (e: unknown) {
    log.warn(`clearNotificationBadge failed: ${String(e)}`);
  }
}

/** Ask for push permission. True for granted or provisional (quiet) grants. */
export async function requestPushPermission(): Promise<boolean> {
  log.info('requesting push notification permission');
  const status = await requestPermission(fcm, {
    sound: false, // once-daily quiet push — no sound
    badge: true,
    alert: true,
    provisional: false,
  });
  const granted = isGranted(status);
  if (granted) log.info(`push permission granted (status: ${status})`);
  else log.warn(`push permission denied (status: ${status})`);
  return granted;
}

/** Fetch the current FCM token. Returns null when unavailable. */
export async function getFcmToken(): Promise<string | null> {
  try {
    const token = await getToken(fcm);
    if (token) log.info(`FCM token obtained: ${token.slice(0, 20)}…`);
    else log.warn('FCM token unavailable — getToken returned empty string');
    return token || null;
  } catch (e) {
    log.warn(`getFcmToken failed: ${String(e)}`);
    return null;
  }
}

/** Live OS permission state for this app. */
export async function getNotificationPermission(): Promise<boolean> {
  const status = await hasPermission(fcm);
  return isGranted(status);
}

/** Subscribe to FCM token rotation. Returns the unsubscribe function. */
export function onFcmTokenRefresh(onToken: (token: string) => void): () => void {
  return onTokenRefresh(fcm, onToken);
}

/**
 * Wire the three notification-interaction handlers (background tap, killed-app
 * initial notification, foreground message). Each fires `onDailyDigest` only
 * for a `daily_digest` payload, after clearing the badge. Returns an unsubscribe.
 */
export function registerNotificationHandlers(onDailyDigest: () => void): () => void {
  let cancelled = false;
  log.info('registering FCM notification handlers');

  const handle = (source: string, data: Record<string, unknown> | undefined): void => {
    log.info(`${source}: type=${String(data?.['type'])}`);
    if (data?.['type'] === DAILY_DIGEST_TYPE) {
      void clearNotificationBadge();
      onDailyDigest();
    }
  };

  const unsubBackground = onNotificationOpenedApp(fcm, (msg) =>
    handle('onNotificationOpenedApp', msg.data),
  );

  // One-shot read — cancelled guard prevents acting after unmount.
  getInitialNotification(fcm)
    .then((msg) => {
      if (!cancelled && msg) handle('getInitialNotification', msg.data);
    })
    .catch((e: unknown) => log.warn(`getInitialNotification failed: ${String(e)}`));

  const unsubForeground = onMessage(fcm, (msg) => handle('onMessage (foreground)', msg.data));

  return () => {
    cancelled = true;
    unsubBackground();
    unsubForeground();
  };
}
