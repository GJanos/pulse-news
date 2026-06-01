import type { Session } from '@supabase/supabase-js';
import { handleAuthReady } from '../hooks/useAuthInit';
import { useAppStore } from '../store';

beforeEach(() => {
  useAppStore.setState({
    appState: 'auth-check',
    session: null,
    authReady: false,
    isPasswordRecovery: false,
    prefsHydrated: false,
    deviceReady: false,
  });
});

describe('handleAuthReady', () => {
  it('does nothing when authReady is false', () => {
    handleAuthReady(false);
    expect(useAppStore.getState().appState).toBe('auth-check');
  });

  it('transitions to unauthenticated when authReady=true and no session', () => {
    useAppStore.setState({ session: null });
    handleAuthReady(true);
    expect(useAppStore.getState().appState).toBe('unauthenticated');
  });

  it('transitions to prefs-loading when authReady=true and session exists', () => {
    useAppStore.setState({ session: { user: { email: 'a@b.com' } } as unknown as Session });
    handleAuthReady(true);
    expect(useAppStore.getState().appState).toBe('prefs-loading');
  });

  it('does not regress to prefs-loading when prefs already hydrated to ready', () => {
    // Boot race: usePreferences reaches 'ready' before getSession resolves authReady.
    useAppStore.setState({
      session: { user: { email: 'a@b.com' } } as unknown as Session,
      appState: 'ready',
    });
    handleAuthReady(true);
    expect(useAppStore.getState().appState).toBe('ready');
  });

  it('still forces unauthenticated even if appState was optimistically ready', () => {
    useAppStore.setState({ session: null, appState: 'ready' });
    handleAuthReady(true);
    expect(useAppStore.getState().appState).toBe('unauthenticated');
  });

  it('advances straight to ready when prefs + device are already done', () => {
    useAppStore.setState({
      session: { user: { id: 'u1', email: 'a@b.com' } } as unknown as Session,
      prefsHydrated: true,
      deviceReady: true,
    });
    handleAuthReady(true);
    expect(useAppStore.getState().appState).toBe('ready');
  });
});
