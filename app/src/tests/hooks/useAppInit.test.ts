import { renderHook } from '@testing-library/react-native';
import { useAppStore } from '../../store';
import { useAppInit } from '../../hooks/useAppInit';

jest.mock('../../storage/mmkv', () => ({
  storage: {
    getString: jest.fn<string | undefined, [string]>(() => undefined),
    set: jest.fn<void, [string, string]>(),
    remove: jest.fn<boolean, [string]>(),
  },
  supabaseStorage: {},
}));

beforeEach(() => {
  useAppStore.setState({ appState: 'booting' });
});

it('does not advance the boot machine while fonts are not ready', () => {
  renderHook(() => useAppInit(false));
  expect(useAppStore.getState().appState).toBe('booting');
});

it('advances booting → auth-check once fonts are ready', () => {
  renderHook(() => useAppInit(true));
  expect(useAppStore.getState().appState).toBe('auth-check');
});

it('does not regress a boot machine that already advanced past booting', () => {
  // The cached auth/prefs/device flow can reach 'ready' before fonts resolve.
  // useAppInit firing late must not claw it back to 'auth-check'.
  useAppStore.setState({ appState: 'ready' });
  renderHook(() => useAppInit(true));
  expect(useAppStore.getState().appState).toBe('ready');
});

it('does not regress an unauthenticated machine back to auth-check', () => {
  useAppStore.setState({ appState: 'unauthenticated' });
  renderHook(() => useAppInit(true));
  expect(useAppStore.getState().appState).toBe('unauthenticated');
});
