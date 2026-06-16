import { renderHook, act, waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { useAppStore } from '../../store';
import { usePreferences } from '../../hooks/usePreferences';
import { config } from '../../config';
import {
  DEFAULT_PREFERENCES,
  loadLocalPreferences,
  saveLocalPreferences,
  syncPreferences,
} from '../../storage/preferences';

jest.mock('../../storage/preferences', () => ({
  DEFAULT_PREFERENCES: {
    selectedRegions: ['Hungary'],
    headlineCount: 5,
    regionHeadlineCounts: {},
    historyDays: 7,
    notifyTime: '07:30',
    openLinksIn: 'in-app',
    regionStyle: 'flag',
    baseCurrency: 'USD',
    showCurrencyRates: false,
    showGlobalHeadlines: true,
    globalHeadlineCount: 5,
    theme: 'light',
    aesthetic: 'editorial',
    updatedAt: new Date(0).toISOString(),
  },
  loadLocalPreferences: jest.fn(),
  saveLocalPreferences: jest.fn().mockResolvedValue(undefined),
  syncPreferences: jest.fn(),
  pushRemotePreferences: jest.fn().mockResolvedValue(undefined),
}));

const mockLoad = loadLocalPreferences as jest.MockedFunction<typeof loadLocalPreferences>;
const mockSync = syncPreferences as jest.MockedFunction<typeof syncPreferences>;
const mockSave = saveLocalPreferences as jest.MockedFunction<typeof saveLocalPreferences>;

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  useAppStore.setState({
    appState: 'prefs-loading',
    screen: 'digest',
    session: null,
    prefs: DEFAULT_PREFERENCES,
    prefsMutationCount: 0,
    prefsHydrated: false,
    deviceReady: true,
  });
  mockLoad.mockResolvedValue(null);
  mockSync.mockResolvedValue(DEFAULT_PREFERENCES);
});

afterEach(() => {
  jest.useRealTimers();
});

// ── Hydration ────────────────────────────────────────────────────────

describe('hydration', () => {
  it('calls setPrefs with loaded prefs on MMKV hit', async () => {
    const stored = { ...DEFAULT_PREFERENCES, theme: 'dark' as const };
    mockLoad.mockResolvedValue(stored);
    renderHook(() => usePreferences());
    await waitFor(() => expect(useAppStore.getState().prefs.theme).toBe('dark'));
  });

  it('calls setPrefs with DEFAULT_PREFERENCES on MMKV miss', async () => {
    mockLoad.mockResolvedValue(null);
    renderHook(() => usePreferences());
    await waitFor(() => expect(useAppStore.getState().appState).toBe('ready'));
    expect(useAppStore.getState().prefs).toEqual(DEFAULT_PREFERENCES);
  });

  it('transitions appState to ready after hydration', async () => {
    renderHook(() => usePreferences());
    await waitFor(() => expect(useAppStore.getState().appState).toBe('ready'));
  });

  it('does not call syncPreferences when userId is null', async () => {
    renderHook(() => usePreferences());
    await waitFor(() => expect(useAppStore.getState().appState).toBe('ready'));
    expect(mockSync).not.toHaveBeenCalled();
  });

  it('calls syncPreferences when userId is present', async () => {
    useAppStore.setState({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      session: { user: { id: 'user-abc', email: 'test@test.com' } } as any,
    });
    const synced = { ...DEFAULT_PREFERENCES, theme: 'sepia' as const };
    mockSync.mockResolvedValue(synced);
    renderHook(() => usePreferences());
    await waitFor(() => expect(useAppStore.getState().prefs.theme).toBe('sepia'));
    expect(mockSync).toHaveBeenCalledWith('user-abc');
  });

  it('does not overwrite in-flight user edits with sync result', async () => {
    let resolveSync: (v: typeof DEFAULT_PREFERENCES) => void;
    mockSync.mockReturnValue(
      new Promise((res) => {
        resolveSync = res;
      }),
    );
    useAppStore.setState({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      session: { user: { id: 'user-xyz', email: 'x@test.com' } } as any,
    });
    renderHook(() => usePreferences());
    await waitFor(() => expect(useAppStore.getState().appState).toBe('ready'));

    // User edits a pref while sync is in-flight
    act(() => {
      useAppStore.getState().setPref('theme', 'dark');
    });

    // Sync resolves with the old value
    await act(async () => {
      resolveSync!({ ...DEFAULT_PREFERENCES, theme: 'light' });
    });

    // User's dark theme should be preserved
    expect(useAppStore.getState().prefs.theme).toBe('dark');
  });

  it('does not update store after unmount (cancelled)', async () => {
    let resolveLoad: (v: null) => void;
    mockLoad.mockReturnValue(
      new Promise((res) => {
        resolveLoad = res;
      }),
    );
    const { unmount } = renderHook(() => usePreferences());
    unmount();
    await act(async () => {
      resolveLoad!(null);
    });
    // appState should still be prefs-loading (hook was cancelled)
    expect(useAppStore.getState().appState).toBe('prefs-loading');
  });
});

// ── userId change ────────────────────────────────────────────────────

describe('userId change', () => {
  it('flushes dirty prefs to MMKV before re-hydrating on login', async () => {
    renderHook(() => usePreferences());
    await waitFor(() => expect(useAppStore.getState().appState).toBe('ready'));

    // User makes a pref change — debounce has not fired yet
    act(() => {
      useAppStore.getState().setPref('theme', 'dark');
    });
    expect(mockSave).not.toHaveBeenCalled();

    // Login changes userId before the 900ms debounce fires
    act(() => {
      useAppStore.setState({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        session: { user: { id: 'user-login', email: 'login@test.com' } } as any,
      });
    });

    // flush() must have been called synchronously when userId changed
    expect(mockSave).toHaveBeenCalledTimes(1);
  });
});

// ── Dirty flush (debounced) ──────────────────────────────────────────

describe('dirty flush', () => {
  it('saves to local after the debounce window following a setPref call', async () => {
    renderHook(() => usePreferences());
    await waitFor(() => expect(useAppStore.getState().appState).toBe('ready'));

    act(() => {
      useAppStore.getState().setPref('theme', 'dark');
    });
    expect(mockSave).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(config.prefsDebounceMs);
    });
    expect(mockSave).toHaveBeenCalledTimes(1);
  });

  it('debounces multiple setPref calls into one save', async () => {
    renderHook(() => usePreferences());
    await waitFor(() => expect(useAppStore.getState().appState).toBe('ready'));

    act(() => {
      useAppStore.getState().setPref('theme', 'dark');
      useAppStore.getState().setPref('headlineCount', 3);
      useAppStore.getState().setPref('historyDays', 14);
    });
    act(() => {
      jest.advanceTimersByTime(config.prefsDebounceMs);
    });
    expect(mockSave).toHaveBeenCalledTimes(1);
  });

  it('does not save when no setPref has been called', async () => {
    renderHook(() => usePreferences());
    await waitFor(() => expect(useAppStore.getState().appState).toBe('ready'));
    act(() => {
      jest.advanceTimersByTime(2000);
    });
    expect(mockSave).not.toHaveBeenCalled();
  });
});

// ── AppState flush ───────────────────────────────────────────────────

describe('AppState flush', () => {
  let appStateCallback: (state: string) => void;

  beforeEach(() => {
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, cb) => {
      appStateCallback = cb as (state: string) => void;
      return { remove: jest.fn() };
    });
  });

  afterEach(() => jest.restoreAllMocks());

  it('flushes immediately on background when dirty', async () => {
    renderHook(() => usePreferences());
    await waitFor(() => expect(useAppStore.getState().appState).toBe('ready'));

    act(() => {
      useAppStore.getState().setPref('theme', 'dark');
    });
    act(() => {
      appStateCallback('background');
    });
    expect(mockSave).toHaveBeenCalledTimes(1);
  });

  it('flushes immediately on inactive when dirty', async () => {
    renderHook(() => usePreferences());
    await waitFor(() => expect(useAppStore.getState().appState).toBe('ready'));

    act(() => {
      useAppStore.getState().setPref('theme', 'dark');
    });
    act(() => {
      appStateCallback('inactive');
    });
    expect(mockSave).toHaveBeenCalledTimes(1);
  });

  it('does not flush on background when clean', async () => {
    renderHook(() => usePreferences());
    await waitFor(() => expect(useAppStore.getState().appState).toBe('ready'));
    act(() => {
      appStateCallback('background');
    });
    expect(mockSave).not.toHaveBeenCalled();
  });
});

// ── Screen transition flush ──────────────────────────────────────────

describe('screen transition flush', () => {
  it('flushes immediately when navigating away from settings while dirty', async () => {
    useAppStore.setState({ screen: 'settings' });
    renderHook(() => usePreferences());
    await waitFor(() => expect(useAppStore.getState().appState).toBe('ready'));

    act(() => {
      useAppStore.getState().setPref('theme', 'dark');
    });
    act(() => {
      useAppStore.setState({ screen: 'digest' });
    });
    expect(mockSave).toHaveBeenCalledTimes(1);
  });

  it('does not flush when navigating from digest to settings', async () => {
    renderHook(() => usePreferences());
    await waitFor(() => expect(useAppStore.getState().appState).toBe('ready'));

    act(() => {
      useAppStore.getState().setPref('theme', 'dark');
    });
    mockSave.mockClear();
    act(() => {
      useAppStore.setState({ screen: 'settings' });
    });
    expect(mockSave).not.toHaveBeenCalled();
  });
});
