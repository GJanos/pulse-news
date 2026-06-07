import {
  DEFAULT_PREFERENCES,
  resolveConflict,
  loadLocalPreferences,
  saveLocalPreferences,
  pullRemotePreferences,
  pushRemotePreferences,
  syncPreferences,
} from '../../storage/preferences';

// MMKV is auto-mocked via app/__mocks__/react-native-mmkv.ts (Map-backed mock).
// Supabase has no URL/key in test env so getSupabase() returns null naturally.
// We mock the client module to control Supabase responses per test.
const mockFrom = jest.fn();
const mockSelect = jest.fn();
const mockEq = jest.fn();
const mockMaybeSingle = jest.fn();
const mockUpsert = jest.fn();

jest.mock('../../supabase/client', () => ({
  getSupabase: jest.fn(() => ({
    from: mockFrom,
  })),
}));

beforeEach(async () => {
  jest.clearAllMocks();
  // Clear MMKV mock store so each test starts with an empty cache
  const { storage } = await import('../../storage/mmkv');
  (storage as unknown as { clearAll(): void }).clearAll();
  mockFrom.mockReturnValue({ select: mockSelect, upsert: mockUpsert });
  mockSelect.mockReturnValue({ eq: mockEq });
  mockEq.mockReturnValue({ maybeSingle: mockMaybeSingle });
  mockMaybeSingle.mockResolvedValue({ data: null, error: null });
  mockUpsert.mockResolvedValue({ error: null });
});

// ── resolveConflict ──────────────────────────────────────────────────

describe('resolveConflict', () => {
  it('returns DEFAULT_PREFERENCES when both null', () => {
    expect(resolveConflict(null, null)).toEqual(DEFAULT_PREFERENCES);
  });

  it('returns local when remote is null', () => {
    const local = { ...DEFAULT_PREFERENCES, theme: 'dark' as const };
    expect(resolveConflict(local, null)).toBe(local);
  });

  it('returns remote when local is null', () => {
    const remote = { ...DEFAULT_PREFERENCES, theme: 'dark' as const };
    expect(resolveConflict(null, remote)).toBe(remote);
  });

  it('returns local when local updatedAt is newer', () => {
    const local = { ...DEFAULT_PREFERENCES, updatedAt: '2026-01-02T00:00:00.000Z' };
    const remote = { ...DEFAULT_PREFERENCES, updatedAt: '2026-01-01T00:00:00.000Z' };
    expect(resolveConflict(local, remote)).toBe(local);
  });

  it('returns remote when remote updatedAt is newer', () => {
    const local = { ...DEFAULT_PREFERENCES, updatedAt: '2026-01-01T00:00:00.000Z' };
    const remote = { ...DEFAULT_PREFERENCES, updatedAt: '2026-01-02T00:00:00.000Z' };
    expect(resolveConflict(local, remote)).toBe(remote);
  });

  it('returns local when timestamps are equal (deterministic)', () => {
    const ts = '2026-01-01T00:00:00.000Z';
    const local = { ...DEFAULT_PREFERENCES, updatedAt: ts };
    const remote = { ...DEFAULT_PREFERENCES, updatedAt: ts };
    expect(resolveConflict(local, remote)).toBe(local);
  });
});

// ── loadLocalPreferences ─────────────────────────────────────────────

describe('loadLocalPreferences', () => {
  it('returns null on cache miss', async () => {
    // MMKV mock Map is empty by default in each test
    expect(await loadLocalPreferences()).toBeNull();
  });

  it('returns full prefs merged with defaults on cache hit', async () => {
    const stored = {
      ...DEFAULT_PREFERENCES,
      theme: 'dark' as const,
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    // Write directly to the mocked MMKV store via saveLocalPreferences
    await saveLocalPreferences(stored);
    const result = await loadLocalPreferences();
    expect(result?.theme).toBe('dark');
    expect(result?.headlineCount).toBe(DEFAULT_PREFERENCES.headlineCount);
  });

  it('backfills missing fields from DEFAULT_PREFERENCES', async () => {
    // Simulate a cache written by an older app version (missing fields)
    const { storage } = await import('../../storage/mmkv');
    storage.set(
      'pulse.preferences.v1',
      JSON.stringify({ theme: 'sepia', updatedAt: '2026-01-01T00:00:00.000Z' }),
    );
    const result = await loadLocalPreferences();
    expect(result?.theme).toBe('sepia');
    expect(result?.headlineCount).toBe(DEFAULT_PREFERENCES.headlineCount);
    expect(result?.selectedRegions).toEqual(DEFAULT_PREFERENCES.selectedRegions);
  });

  it('returns null on corrupt JSON without throwing', async () => {
    const { storage } = await import('../../storage/mmkv');
    storage.set('pulse.preferences.v1', 'not-json{{{{');
    expect(await loadLocalPreferences()).toBeNull();
  });
});

// ── saveLocalPreferences ─────────────────────────────────────────────

describe('saveLocalPreferences', () => {
  it('writes JSON under pulse.preferences.v1', async () => {
    await saveLocalPreferences(DEFAULT_PREFERENCES);
    const { storage } = await import('../../storage/mmkv');
    const raw = storage.getString('pulse.preferences.v1');
    expect(JSON.parse(raw!)).toEqual(DEFAULT_PREFERENCES);
  });
});

// ── pullRemotePreferences ────────────────────────────────────────────

describe('pullRemotePreferences', () => {
  it('returns null when no Supabase data', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    expect(await pullRemotePreferences('user-1')).toBeNull();
  });

  it('returns prefs merged with defaults when row found', async () => {
    const remotePrefs = { theme: 'dark', headlineCount: 3 };
    mockMaybeSingle.mockResolvedValue({
      data: { preferences: remotePrefs, updated_at: '2026-01-01T00:00:00.000Z' },
      error: null,
    });
    const result = await pullRemotePreferences('user-1');
    expect(result?.theme).toBe('dark');
    expect(result?.headlineCount).toBe(3);
    expect(result?.selectedRegions).toEqual(DEFAULT_PREFERENCES.selectedRegions);
    expect(result?.updatedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('returns null on Supabase error', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: { message: 'network error' } });
    expect(await pullRemotePreferences('user-1')).toBeNull();
  });
});

// ── pushRemotePreferences ────────────────────────────────────────────

describe('pushRemotePreferences', () => {
  it('resolves without throwing on success', async () => {
    mockUpsert.mockResolvedValue({ error: null });
    await expect(pushRemotePreferences('user-1', DEFAULT_PREFERENCES)).resolves.toBeUndefined();
  });

  it('throws when Supabase returns an error', async () => {
    mockUpsert.mockResolvedValue({ error: { message: 'constraint violation' } });
    await expect(pushRemotePreferences('user-1', DEFAULT_PREFERENCES)).rejects.toThrow(
      'constraint violation',
    );
  });
});

// ── syncPreferences ──────────────────────────────────────────────────

describe('syncPreferences', () => {
  it('returns remote and saves locally when remote is newer', async () => {
    const localPrefs = { ...DEFAULT_PREFERENCES, updatedAt: '2026-01-01T00:00:00.000Z' };
    const remotePrefs = {
      ...DEFAULT_PREFERENCES,
      theme: 'dark' as const,
      updatedAt: '2026-01-02T00:00:00.000Z',
    };
    await saveLocalPreferences(localPrefs);
    mockMaybeSingle.mockResolvedValue({
      data: { preferences: remotePrefs, updated_at: remotePrefs.updatedAt },
      error: null,
    });
    const result = await syncPreferences('user-1');
    expect(result.theme).toBe('dark');
    // Winner should now be in local cache
    const cached = await loadLocalPreferences();
    expect(cached?.theme).toBe('dark');
  });

  it('returns local and pushes to remote when local is newer', async () => {
    const localPrefs = { ...DEFAULT_PREFERENCES, updatedAt: '2026-01-02T00:00:00.000Z' };
    const remotePrefs = { ...DEFAULT_PREFERENCES, updatedAt: '2026-01-01T00:00:00.000Z' };
    await saveLocalPreferences(localPrefs);
    mockMaybeSingle.mockResolvedValue({
      data: { preferences: remotePrefs, updated_at: remotePrefs.updatedAt },
      error: null,
    });
    const result = await syncPreferences('user-1');
    expect(result.updatedAt).toBe('2026-01-02T00:00:00.000Z');
    expect(mockUpsert).toHaveBeenCalled();
  });

  it('returns local and does not upsert when timestamps are equal', async () => {
    const ts = '2026-01-01T00:00:00.000Z';
    const prefs = { ...DEFAULT_PREFERENCES, updatedAt: ts };
    await saveLocalPreferences(prefs);
    mockMaybeSingle.mockResolvedValue({
      data: { preferences: prefs, updated_at: ts },
      error: null,
    });
    await syncPreferences('user-1');
    expect(mockUpsert).not.toHaveBeenCalled();
  });
});

describe('DEFAULT_PREFERENCES image keys', () => {
  it('defaults images on with a photo count of 2', () => {
    expect(DEFAULT_PREFERENCES.imagesEnabled).toBe(true);
    expect(DEFAULT_PREFERENCES.photoCount).toBe(2);
  });

  it('fills image defaults when a legacy cached blob omits them', async () => {
    const { storage } = await import('../../storage/mmkv');
    // Legacy blob without the new keys.
    storage.set(
      'pulse.preferences.v1',
      JSON.stringify({ theme: 'dark', updatedAt: new Date(1).toISOString() }),
    );
    const loaded = await loadLocalPreferences();
    expect(loaded?.imagesEnabled).toBe(true);
    expect(loaded?.photoCount).toBe(2);
  });
});
