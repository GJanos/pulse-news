import { useEffect } from 'react';

import { useAppStore } from '../store';
import { registerNotificationHandlers } from '../notifications/fcm';

/**
 * Registers FCM tap handlers once the boot machine reaches 'ready'. Gating on
 * 'ready' guarantees the killed-app initial notification fires after nav state
 * is restored, so a notification-driven digest navigation is not clobbered.
 * Handlers navigate via the store, so no navigation refs are needed.
 */
export function useNotificationHandlers(): void {
  const appState = useAppStore((s) => s.appState);
  useEffect(() => {
    if (appState !== 'ready') return;
    return registerNotificationHandlers(() => useAppStore.getState().navigateToDigest());
  }, [appState]);
}
