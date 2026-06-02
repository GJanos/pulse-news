import { useEffect } from 'react';
import { useAppStore } from '../store';

/**
 * Called from App.tsx after `useFonts` resolves (loaded or errored).
 * Restores persisted nav state and advances the boot machine to 'auth-check'.
 * Auth-flow's useSupabaseAuth picks up from there.
 */
export function useAppInit(fontsReady: boolean): void {
  const setAppState = useAppStore((s) => s.setAppState);
  const restoreNavState = useAppStore((s) => s.restoreNavState);

  useEffect(() => {
    if (!fontsReady) return;
    restoreNavState();
    // Only advance forward. Fonts can resolve *after* the cached auth/prefs/
    // device flow has already driven the boot machine past 'booting' (even all
    // the way to 'ready'); unconditionally setting 'auth-check' here would
    // regress it and strand the app on the splash, as nothing re-advances it.
    if (useAppStore.getState().appState === 'booting') setAppState('auth-check');
  }, [fontsReady, setAppState, restoreNavState]);
}
