import { createPrefsSlice, type PrefsSlice } from '../../../store/slices/prefs';
import { DEFAULT_PREFERENCES } from '../../../storage/preferences';

function makeSlice(): { slice: PrefsSlice; setSpy: jest.Mock } {
  let state: PrefsSlice = {} as PrefsSlice;
  // set() can be called with an object OR a function — support both
  const setSpy = jest.fn(
    (partialOrFn: Partial<PrefsSlice> | ((s: PrefsSlice) => Partial<PrefsSlice>)) => {
      if (typeof partialOrFn === 'function') {
        state = { ...state, ...partialOrFn(state) };
      } else {
        state = { ...state, ...partialOrFn };
      }
    },
  );
  state = createPrefsSlice(
    setSpy as unknown as Parameters<typeof createPrefsSlice>[0],
    () => state,
    {} as unknown as Parameters<typeof createPrefsSlice>[2],
  );
  // Create a proxy that always returns the latest state properties
  const slice = new Proxy({} as PrefsSlice, {
    get(target, prop: string | symbol) {
      if (prop === Symbol.toStringTag || prop === 'constructor') {
        return undefined;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (state as any)[prop];
    },
  });
  return { slice, setSpy };
}

describe('PrefsSlice', () => {
  it('initialises with DEFAULT_PREFERENCES', () => {
    const { slice } = makeSlice();
    expect(slice.prefs).toEqual(DEFAULT_PREFERENCES);
  });

  it('initialises prefsMutationCount at 0', () => {
    const { slice } = makeSlice();
    expect(slice.prefsMutationCount).toBe(0);
  });

  it('setPrefs replaces the full prefs object', () => {
    const { slice } = makeSlice();
    const updated = { ...DEFAULT_PREFERENCES, historyDays: 14 };
    slice.setPrefs(updated);
    expect(slice.prefs.historyDays).toBe(14);
  });

  it('setPrefs does NOT increment prefsMutationCount', () => {
    const { slice } = makeSlice();
    slice.setPrefs({ ...DEFAULT_PREFERENCES, historyDays: 14 });
    expect(slice.prefsMutationCount).toBe(0);
  });

  it('setPrefs does not mutate DEFAULT_PREFERENCES', () => {
    const { slice } = makeSlice();
    slice.setPrefs({ ...DEFAULT_PREFERENCES, historyDays: 14 });
    expect(DEFAULT_PREFERENCES.historyDays).toBe(7);
  });

  it('setPref updates only the targeted key', () => {
    const { slice } = makeSlice();
    slice.setPref('theme', 'dark');
    expect(slice.prefs.theme).toBe('dark');
    expect(slice.prefs.headlineCount).toBe(DEFAULT_PREFERENCES.headlineCount);
    expect(slice.prefs.selectedRegions).toEqual(DEFAULT_PREFERENCES.selectedRegions);
  });

  it('setPref bumps updatedAt to a newer timestamp', () => {
    const { slice } = makeSlice();
    const before = slice.prefs.updatedAt;
    // Ensure clock advances
    jest.spyOn(Date.prototype, 'toISOString').mockReturnValueOnce('2099-01-01T00:00:00.000Z');
    slice.setPref('theme', 'sepia');
    expect(slice.prefs.updatedAt).not.toBe(before);
    jest.restoreAllMocks();
  });

  it('setPref increments prefsMutationCount', () => {
    const { slice } = makeSlice();
    slice.setPref('theme', 'dark');
    expect(slice.prefsMutationCount).toBe(1);
    slice.setPref('headlineCount', 3);
    expect(slice.prefsMutationCount).toBe(2);
  });

  it('DEFAULT_PREFERENCES.showGlobalHeadlines is true', () => {
    expect(DEFAULT_PREFERENCES.showGlobalHeadlines).toBe(true);
  });

  it('DEFAULT_PREFERENCES has 5 selected regions', () => {
    expect(DEFAULT_PREFERENCES.selectedRegions).toHaveLength(5);
  });

  it('DEFAULT_PREFERENCES theme is dark', () => {
    expect(DEFAULT_PREFERENCES.theme).toBe('dark');
  });

  it('DEFAULT_PREFERENCES aesthetic is editorial', () => {
    expect(DEFAULT_PREFERENCES.aesthetic).toBe('editorial');
  });

  it('DEFAULT_PREFERENCES baseCurrency is USD', () => {
    expect(DEFAULT_PREFERENCES.baseCurrency).toBe('USD');
  });

  it('DEFAULT_PREFERENCES headlineCount is 5', () => {
    expect(DEFAULT_PREFERENCES.headlineCount).toBe(5);
  });
});
