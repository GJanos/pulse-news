import { create } from 'zustand';
import { createAppSlice, type AppSlice } from '../../../store/slices/app';

function makeStore() {
  return create<AppSlice>()((...a) => ({ ...createAppSlice(...a) }));
}

describe('app slice — boot state machine', () => {
  it('initializes with booting', () => {
    expect(makeStore().getState().appState).toBe('booting');
  });

  it('transitions to auth-check', () => {
    const s = makeStore();
    s.getState().setAppState('auth-check');
    expect(s.getState().appState).toBe('auth-check');
  });

  it('transitions to unauthenticated', () => {
    const s = makeStore();
    s.getState().setAppState('unauthenticated');
    expect(s.getState().appState).toBe('unauthenticated');
  });

  it('transitions to prefs-loading', () => {
    const s = makeStore();
    s.getState().setAppState('prefs-loading');
    expect(s.getState().appState).toBe('prefs-loading');
  });

  it('transitions to ready', () => {
    const s = makeStore();
    s.getState().setAppState('ready');
    expect(s.getState().appState).toBe('ready');
  });

  it('transitions to update-required', () => {
    const s = makeStore();
    s.getState().setAppState('update-required');
    expect(s.getState().appState).toBe('update-required');
  });

  it('transitions to maintenance', () => {
    const s = makeStore();
    s.getState().setAppState('maintenance');
    expect(s.getState().appState).toBe('maintenance');
  });

  it('each store instance is independent', () => {
    const a = makeStore();
    const b = makeStore();
    a.getState().setAppState('ready');
    expect(b.getState().appState).toBe('booting');
  });
});

describe('app slice — boot gate', () => {
  it('starts with flags down', () => {
    const s = makeStore().getState();
    expect(s.prefsHydrated).toBe(false);
    expect(s.deviceReady).toBe(false);
  });

  it('advances to ready only when prefs-loading AND both flags set', () => {
    const s = makeStore();
    s.getState().setAppState('prefs-loading');
    s.getState().setPrefsHydrated(true);
    expect(s.getState().appState).toBe('prefs-loading'); // device not ready yet
    s.getState().setDeviceReady(true);
    expect(s.getState().appState).toBe('ready');
  });

  it('does not advance from auth-check even with both flags set', () => {
    const s = makeStore();
    s.getState().setAppState('auth-check');
    s.getState().setPrefsHydrated(true);
    s.getState().setDeviceReady(true);
    expect(s.getState().appState).toBe('auth-check');
  });

  it('maybeAdvanceToReady is a no-op when already unauthenticated', () => {
    const s = makeStore();
    s.getState().setAppState('unauthenticated');
    s.getState().setPrefsHydrated(true);
    s.getState().setDeviceReady(true);
    s.getState().maybeAdvanceToReady();
    expect(s.getState().appState).toBe('unauthenticated');
  });
});
