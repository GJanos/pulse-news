import { create } from 'zustand';
import { createNavSlice, NAV_KEY, NAV_TTL_MS, type NavSlice } from '../../../store/slices/nav';

jest.mock('../../../logger', () => ({
  getLogger: jest.fn(() => ({
    debug: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
  })),
}));

// nav.ts calls getLogger once at module load time — capture the result before clearAllMocks runs.
const { getLogger: mockGetLogger } = jest.requireMock('../../../logger') as {
  getLogger: jest.Mock;
};
let logDebug: jest.Mock;

beforeAll(() => {
  const logMock = mockGetLogger.mock.results[0]?.value as { debug: jest.Mock };
  logDebug = logMock.debug;
});

jest.mock('../../../storage/mmkv', () => ({
  storage: {
    getString: jest.fn<string | undefined, [string]>(),
    set: jest.fn<void, [string, string]>(),
    remove: jest.fn<boolean, [string]>(),
  },
  supabaseStorage: {},
}));

const mockStorage = (
  jest.requireMock('../../../storage/mmkv') as {
    storage: {
      getString: jest.Mock;
      set: jest.Mock;
      remove: jest.Mock;
    };
  }
).storage;

function makeStore() {
  return create<NavSlice>()((...a) => ({ ...createNavSlice(...a) }));
}

function savedNav(overrides: Partial<{ screen: string; dayIndex: number; savedAt: number }> = {}) {
  return JSON.stringify({
    screen: 'digest',
    dayIndex: 0,
    article: null,
    savedAt: Date.now(),
    ...overrides,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockStorage.getString.mockReturnValue(undefined);
});

describe('nav slice — logging', () => {
  it('setScreen logs the transition from the previous screen', () => {
    const s = makeStore();
    s.getState().setScreen('settings');
    expect(logDebug).toHaveBeenCalledWith('screen digest → settings');
  });

  it('setScreen still updates the screen after logging', () => {
    const s = makeStore();
    s.getState().setScreen('settings');
    expect(s.getState().screen).toBe('settings');
  });

  it('navigateToDigest logs the notification-driven navigation', () => {
    const s = makeStore();
    s.getState().setScreen('settings');
    logDebug.mockClear();
    s.getState().navigateToDigest();
    expect(logDebug).toHaveBeenCalledWith('screen → digest (notification)');
  });

  it('setDayIndex logs the new day index', () => {
    const s = makeStore();
    s.getState().setDayIndex(3);
    expect(logDebug).toHaveBeenCalledWith('dayIndex 3');
  });

  it('setArticle logs article open and close', () => {
    const s = makeStore();
    const entry = {
      h: { title: 'Test', summary: 'Sum', url: 'https://example.com' },
      r: {
        region: 'Hungary',
        country: 'HU',
        code: 'HUN',
        continent: 'Europe' as const,
        currency: 'HUF',
        sources: [],
      },
    };
    s.getState().setArticle(entry);
    expect(logDebug).toHaveBeenCalledWith('article open (Test)');
    logDebug.mockClear();
    s.getState().setArticle(null);
    expect(logDebug).toHaveBeenCalledWith('article close');
  });

  it('navigateToDigest still resets to digest after logging', () => {
    const s = makeStore();
    s.getState().setScreen('settings');
    s.getState().setDayIndex(3);
    s.getState().navigateToDigest();
    expect(s.getState().screen).toBe('digest');
    expect(s.getState().dayIndex).toBe(0);
  });
});

describe('nav slice — initial state', () => {
  it('screen defaults to digest', () => {
    expect(makeStore().getState().screen).toBe('digest');
  });

  it('dayIndex defaults to 0', () => {
    expect(makeStore().getState().dayIndex).toBe(0);
  });

  it('article defaults to null', () => {
    expect(makeStore().getState().article).toBeNull();
  });
});

describe('nav slice — setters', () => {
  it('setScreen updates screen', () => {
    const s = makeStore();
    s.getState().setScreen('settings');
    expect(s.getState().screen).toBe('settings');
  });

  it('setDayIndex updates dayIndex', () => {
    const s = makeStore();
    s.getState().setDayIndex(5);
    expect(s.getState().dayIndex).toBe(5);
  });

  it('setArticle updates article', () => {
    const s = makeStore();
    const entry = {
      h: { title: 'Test', summary: 'Sum', url: 'https://example.com' },
      r: {
        region: 'Hungary',
        country: 'HU',
        code: 'HUN',
        continent: 'Europe' as const,
        currency: 'HUF',
        sources: [],
      },
    };
    s.getState().setArticle(entry);
    expect(s.getState().article).toEqual(entry);
  });

  it('setArticle can clear to null', () => {
    const s = makeStore();
    s.getState().setArticle({
      h: { title: 'T', summary: 'S', url: 'u' },
      r: {
        region: 'Hungary',
        country: 'HU',
        code: 'HUN',
        continent: 'Europe' as const,
        currency: 'HUF',
        sources: [],
      },
    });
    s.getState().setArticle(null);
    expect(s.getState().article).toBeNull();
  });
});

describe('nav slice — restoreNavState', () => {
  it('does nothing when MMKV is empty', () => {
    mockStorage.getString.mockReturnValue(undefined);
    const s = makeStore();
    s.getState().restoreNavState();
    expect(s.getState().screen).toBe('digest');
    expect(s.getState().dayIndex).toBe(0);
  });

  it('restores valid persisted state', () => {
    mockStorage.getString.mockReturnValue(savedNav({ screen: 'settings', dayIndex: 3 }));
    const s = makeStore();
    s.getState().restoreNavState();
    expect(s.getState().screen).toBe('settings');
    expect(s.getState().dayIndex).toBe(3);
  });

  it('falls back to digest for persisted splash screen', () => {
    mockStorage.getString.mockReturnValue(savedNav({ screen: 'splash', dayIndex: 0 }));
    const s = makeStore();
    s.getState().restoreNavState();
    expect(s.getState().screen).toBe('digest');
  });

  it('falls back to digest for persisted login screen', () => {
    mockStorage.getString.mockReturnValue(savedNav({ screen: 'login', dayIndex: 0 }));
    const s = makeStore();
    s.getState().restoreNavState();
    expect(s.getState().screen).toBe('digest');
  });

  it('falls back to defaults when TTL expired and deletes the stale key', () => {
    mockStorage.getString.mockReturnValue(
      savedNav({ screen: 'settings', dayIndex: 2, savedAt: Date.now() - NAV_TTL_MS - 1000 }),
    );
    const s = makeStore();
    s.getState().restoreNavState();
    expect(s.getState().screen).toBe('digest');
    expect(s.getState().dayIndex).toBe(0);
    expect(mockStorage.remove).toHaveBeenCalledWith(NAV_KEY);
  });

  it('falls back to defaults for unknown screen name and deletes the stale key', () => {
    mockStorage.getString.mockReturnValue(savedNav({ screen: 'article' }));
    const s = makeStore();
    s.getState().restoreNavState();
    expect(s.getState().screen).toBe('digest');
    expect(mockStorage.remove).toHaveBeenCalledWith(NAV_KEY);
  });

  it('does not crash on corrupted JSON', () => {
    mockStorage.getString.mockReturnValue('not-valid-json{{{');
    const s = makeStore();
    expect(() => s.getState().restoreNavState()).not.toThrow();
    expect(s.getState().screen).toBe('digest');
  });
});

describe('navigateToDigest', () => {
  it('starts with a zero refresh nonce', () => {
    expect(makeStore().getState().digestRefreshNonce).toBe(0);
  });

  it('sets digest screen, resets day index, and bumps the refresh nonce', () => {
    const s = makeStore();
    s.getState().setScreen('settings');
    s.getState().setDayIndex(3);
    const before = s.getState().digestRefreshNonce;
    s.getState().navigateToDigest();
    expect(s.getState().screen).toBe('digest');
    expect(s.getState().dayIndex).toBe(0);
    expect(s.getState().digestRefreshNonce).toBe(before + 1);
  });

  it('bumps the nonce monotonically on repeated calls', () => {
    const s = makeStore();
    s.getState().navigateToDigest();
    s.getState().navigateToDigest();
    s.getState().navigateToDigest();
    expect(s.getState().digestRefreshNonce).toBe(3);
  });

  it('still resets the day index when already on the digest screen', () => {
    const s = makeStore();
    s.getState().setDayIndex(4);
    s.getState().navigateToDigest();
    expect(s.getState().screen).toBe('digest');
    expect(s.getState().dayIndex).toBe(0);
  });

  it('clears an open article so the digest is not hidden behind a stale overlay', () => {
    const s = makeStore();
    s.getState().setArticle({
      h: { title: 'T', summary: 'S', url: 'u' },
      r: {
        region: 'Hungary',
        country: 'HU',
        code: 'HUN',
        continent: 'Europe' as const,
        currency: 'HUF',
        sources: [],
      },
    });
    s.getState().navigateToDigest();
    expect(s.getState().article).toBeNull();
  });
});

describe('reader state', () => {
  it('readerUrl starts null', () => {
    const s = makeStore();
    expect(s.getState().readerUrl).toBeNull();
  });

  it('setReaderUrl stores a url', () => {
    const s = makeStore();
    s.getState().setReaderUrl('https://example.com/article');
    expect(s.getState().readerUrl).toBe('https://example.com/article');
  });

  it('setReaderUrl(null) clears readerUrl', () => {
    const s = makeStore();
    s.getState().setReaderUrl('https://example.com/article');
    s.getState().setReaderUrl(null);
    expect(s.getState().readerUrl).toBeNull();
  });

  it('readerCanGoBack starts false', () => {
    const s = makeStore();
    expect(s.getState().readerCanGoBack).toBe(false);
  });

  it('setReaderCanGoBack toggles the flag', () => {
    const s = makeStore();
    s.getState().setReaderCanGoBack(true);
    expect(s.getState().readerCanGoBack).toBe(true);
    s.getState().setReaderCanGoBack(false);
    expect(s.getState().readerCanGoBack).toBe(false);
  });

  it('readerBackFn starts null', () => {
    const s = makeStore();
    expect(s.getState().readerBackFn).toBeNull();
  });

  it('setReaderBackFn stores and clears the fn', () => {
    const s = makeStore();
    const fn = jest.fn();
    s.getState().setReaderBackFn(fn);
    expect(s.getState().readerBackFn).toBe(fn);
    s.getState().setReaderBackFn(null);
    expect(s.getState().readerBackFn).toBeNull();
  });
});
