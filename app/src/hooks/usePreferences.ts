import { useCallback, useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useAppStore } from '../store';
import { config } from '../config';
import {
  DEFAULT_PREFERENCES,
  loadLocalPreferences,
  saveLocalPreferences,
  syncPreferences,
  pushRemotePreferences,
} from '../storage/preferences';
import { getLogger } from '../logger';

const log = getLogger('usePreferences');

/** Store-writer hook. Hydrates prefs from MMKV on mount, background-syncs
 *  from Supabase, and debounces dirty writes back to both stores. */
export function usePreferences(): void {
  const setPrefs = useAppStore((s) => s.setPrefs);
  const setPrefsHydrated = useAppStore((s) => s.setPrefsHydrated);
  const screen = useAppStore((s) => s.screen);
  const userId = useAppStore((s) => s.session?.user.id ?? null);
  const mutationCount = useAppStore((s) => s.prefsMutationCount);

  const dirtyRef = useRef(false);
  // Kept in sync via store subscription below — no React selector so App doesn't re-render on pref changes.
  const prefsRef = useRef(useAppStore.getState().prefs);
  const userIdRef = useRef(userId);
  userIdRef.current = userId;
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevScreenRef = useRef(screen);

  // Sync prefsRef with the store without subscribing via React selector (avoids re-renders in App).
  useEffect(() => {
    prefsRef.current = useAppStore.getState().prefs;
    return useAppStore.subscribe((s) => {
      prefsRef.current = s.prefs;
    });
  }, []);

  const flush = useCallback((): void => {
    if (!dirtyRef.current) return;
    dirtyRef.current = false;
    log.debug('flushing prefs');
    saveLocalPreferences(prefsRef.current).catch((e: unknown) => {
      log.warn(`local save failed: ${String(e)}`);
    });
    if (userIdRef.current) {
      pushRemotePreferences(userIdRef.current, prefsRef.current).catch((e: unknown) => {
        log.warn(`remote push failed: ${String(e)}`);
      });
    }
  }, []);

  // Hydration + background Supabase sync
  useEffect(() => {
    // Flush any pending dirty write first so in-flight edits survive login/logout transitions.
    if (dirtyRef.current) flush();
    let cancelled = false;
    log.info('hydrating preferences');

    void (async () => {
      const local = await loadLocalPreferences();
      if (cancelled) return;
      setPrefs(local ?? DEFAULT_PREFERENCES);
      setPrefsHydrated(true);
      log.info('hydration complete');

      if (userId) {
        log.debug('starting background sync');
        const winner = await syncPreferences(userId);
        if (!cancelled && !dirtyRef.current) {
          setPrefs(winner);
          log.info('remote sync complete');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userId, flush]);

  // Dirty tracking + debounced flush — only reacts to user setPref calls,
  // not to setPrefs (hydration/sync), because mutationCount is only incremented by setPref.
  useEffect(() => {
    if (mutationCount === 0) return;
    dirtyRef.current = true;
    if (flushTimer.current) clearTimeout(flushTimer.current);
    flushTimer.current = setTimeout(() => {
      flush();
      flushTimer.current = null;
    }, config.prefsDebounceMs);
    return () => {
      if (flushTimer.current) {
        clearTimeout(flushTimer.current);
        flushTimer.current = null;
      }
    };
  }, [mutationCount, flush]);

  // Flush on unmount if dirty (catches e.g. component tree teardown)
  useEffect(() => {
    return () => {
      if (flushTimer.current) {
        clearTimeout(flushTimer.current);
        flushTimer.current = null;
      }
      flush();
    };
  }, [flush]);

  // Flush when navigating away from settings screen
  useEffect(() => {
    if (prevScreenRef.current === 'settings' && screen !== 'settings') flush();
    prevScreenRef.current = screen;
  }, [screen, flush]);

  // Flush when app goes to background or inactive
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'background' || state === 'inactive') flush();
    });
    return () => sub.remove();
  }, [flush]);
}
