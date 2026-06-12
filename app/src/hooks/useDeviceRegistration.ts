import { useEffect } from 'react';
import { AppState } from 'react-native';

import { useAppStore } from '../store';
import { config } from '../config';
import { registerForPushNotifications, listenForTokenRefresh } from '../notifications/register';
import { getNotificationPermission, ensureDefaultChannel } from '../notifications/fcm';
import { linkDeviceToUser, updateNotifyTime } from '../notifications/devices';
import { localTimeToUTC } from '../utils/time';
import { getLogger } from '../logger';

const log = getLogger('useDeviceRegistration');

/**
 * Store-writer hook. Runs the FCM registration lifecycle on mount (with a
 * timeout guard so a slow Firebase call never blocks boot), keeps
 * `notificationsEnabled` live across foregrounds, links the device to the
 * signed-in user, and syncs notify_at when the preference changes. Writes
 * everything to the store; returns nothing.
 */
export function useDeviceRegistration(): void {
  // Registration lifecycle — runs once.
  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    const { setDeviceRegistration, setNotificationsEnabled, setDeviceReady } =
      useAppStore.getState();

    log.info('starting device registration');
    // Create the Android channel the cron's pushes target before any can arrive.
    // Independent of permission/token — channel creation needs neither and must
    // happen even if registration later aborts.
    void ensureDefaultChannel();
    const timer = setTimeout(() => {
      if (!cancelled) {
        log.warn(
          `device registration timed out after ${config.deviceRegistrationTimeoutMs}ms — continuing without push`,
        );
        setDeviceReady(true);
      }
    }, config.deviceRegistrationTimeoutMs);
    // Don't keep the event loop (or a Jest worker) alive waiting on the guard.
    timer.unref?.();

    void (async () => {
      try {
        const reg = await registerForPushNotifications();
        if (cancelled) return;
        if (reg) {
          setDeviceRegistration(reg);
          unsubscribe = listenForTokenRefresh(reg.deviceId);
          log.info(
            `device registered: ${reg.deviceId.slice(0, 8)}… fcm=${reg.fcmToken.slice(0, 20)}…`,
          );
        } else {
          log.warn('device registration returned null — push permission denied or no FCM token');
        }
        const enabled = await getNotificationPermission();
        if (!cancelled) setNotificationsEnabled(enabled);
      } catch (e) {
        // Push is best-effort — registration failure must not crash the app.
        log.warn(`registerForPushNotifications threw: ${String(e)}`);
        // Registration threw before reading permission — reflect the real OS
        // state anyway so the Settings banner isn't stuck on a stale value.
        try {
          const enabled = await getNotificationPermission();
          if (!cancelled) setNotificationsEnabled(enabled);
        } catch (permErr) {
          log.warn(`permission read after registration failure failed: ${String(permErr)}`);
        }
      } finally {
        clearTimeout(timer);
        if (!cancelled) setDeviceReady(true);
      }
    })();

    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      getNotificationPermission()
        .then((enabled) => useAppStore.getState().setNotificationsEnabled(enabled))
        .catch((e: unknown) => log.warn(`foreground permission re-check failed: ${String(e)}`));
    });

    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (unsubscribe) unsubscribe();
      sub.remove();
    };
  }, []);

  // Link device to the signed-in user.
  const userId = useAppStore((s) => s.session?.user.id ?? null);
  const deviceId = useAppStore((s) => s.deviceId);
  useEffect(() => {
    if (!userId || !deviceId) return;
    linkDeviceToUser(deviceId, userId).catch((e: unknown) =>
      log.warn(`linkDeviceToUser failed: ${String(e)}`),
    );
  }, [userId, deviceId]);

  // Sync notify_at when the preference changes (gated on hydration so the
  // default is never pushed before remote sync resolves).
  const prefsHydrated = useAppStore((s) => s.prefsHydrated);
  const notifyTime = useAppStore((s) => s.prefs.notifyTime);
  useEffect(() => {
    if (!deviceId || !prefsHydrated) return;
    updateNotifyTime(deviceId, localTimeToUTC(notifyTime)).catch((e: unknown) =>
      log.warn(`updateNotifyTime failed: ${String(e)}`),
    );
  }, [deviceId, prefsHydrated, notifyTime]);
}
