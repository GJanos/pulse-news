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
import { setBadgeCountAsync } from 'expo-notifications';

import { DAILY_DIGEST_TYPE } from './keys';
import { getLogger } from '../logger';

const fcm = getMessaging();
const log = getLogger('fcm');

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
