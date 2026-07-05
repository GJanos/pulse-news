import { useEffect } from 'react';
import { AppState } from 'react-native';

import { clearNotifications } from '../notifications/fcm';

/**
 * Resets the app-icon badge and clears delivered notifications whenever the user
 * brings the app to the foreground — including a plain launcher-icon open or a
 * background→active resume, neither of which fires any of the FCM interaction
 * handlers (those only run on a notification *tap* or foreground receipt). Runs
 * once on mount (covers cold launch) and on every transition to 'active'.
 */
export function useNotificationClearing(): void {
  useEffect(() => {
    void clearNotifications();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void clearNotifications();
    });
    return () => sub.remove();
  }, []);
}
