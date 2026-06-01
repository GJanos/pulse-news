import type { StateCreator } from 'zustand';
import type { AppState } from '../../types';

export type { AppState };

export interface AppSlice {
  appState: AppState;
  /** True once local preferences have hydrated from MMKV. */
  prefsHydrated: boolean;
  /** True once device registration resolved — success, denial, OR timeout. */
  deviceReady: boolean;
  setAppState: (state: AppState) => void;
  setPrefsHydrated: (v: boolean) => void;
  setDeviceReady: (v: boolean) => void;
  /** Transition prefs-loading → ready once both boot inputs are satisfied. */
  maybeAdvanceToReady: () => void;
}

export const createAppSlice: StateCreator<AppSlice> = (set, get) => ({
  appState: 'booting',
  prefsHydrated: false,
  deviceReady: false,
  setAppState: (appState) => set({ appState }),
  setPrefsHydrated: (prefsHydrated) => {
    set({ prefsHydrated });
    if (prefsHydrated) get().maybeAdvanceToReady();
  },
  setDeviceReady: (deviceReady) => {
    set({ deviceReady });
    if (deviceReady) get().maybeAdvanceToReady();
  },
  maybeAdvanceToReady: () => {
    const { appState, prefsHydrated, deviceReady } = get();
    if (appState === 'prefs-loading' && prefsHydrated && deviceReady) {
      set({ appState: 'ready' });
    }
  },
});
