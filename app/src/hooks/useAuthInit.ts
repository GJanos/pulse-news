import { useEffect } from 'react';
import { useAppStore } from '../store';
import { useSupabaseAuth, type AuthActions } from './useSupabaseAuth';

export function handleAuthReady(authReady: boolean): void {
  if (!authReady) return;
  const { session, appState, setAppState, maybeAdvanceToReady } = useAppStore.getState();
  if (!session) {
    setAppState('unauthenticated');
    return;
  }
  // Prefs hydration can reach the flags before getSession resolves authReady.
  // Don't regress a machine already at 'ready'; otherwise enter prefs-loading
  // and immediately try to advance in case both boot inputs are already done.
  if (appState !== 'ready') setAppState('prefs-loading');
  maybeAdvanceToReady();
}

export function useAuthInit(): AuthActions {
  const actions = useSupabaseAuth();
  const authReady = useAppStore((s) => s.authReady);

  useEffect(() => {
    handleAuthReady(authReady);
  }, [authReady]);

  return actions;
}
