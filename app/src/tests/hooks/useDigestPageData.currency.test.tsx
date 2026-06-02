import { renderHook } from '@testing-library/react-native';
import { useDigestPageData } from '../../hooks/useDigestPageData';

// ── capture the args passed to useCurrencyRates ───────────────────────
const mockUseCurrencyRates = jest.fn((..._args: unknown[]) => ({
  rates: {},
  forceRefresh: jest.fn(),
}));
jest.mock('../../hooks/useCurrencyRates', () => ({
  useCurrencyRates: (...args: unknown[]) => mockUseCurrencyRates(...args),
}));

jest.mock('../../hooks/useDigest', () => ({
  useDigest: () => ({
    digest: undefined,
    error: null,
    isLoading: false,
    forceRefresh: jest.fn(() => Promise.resolve()),
  }),
}));

jest.mock('../../hooks/useGlobalHeadlines', () => ({
  useGlobalHeadlines: () => ({ headlines: [], forceRefresh: jest.fn() }),
}));

jest.mock('../../data', () => ({
  sortedSelectedRegions: (regions: string[]) =>
    regions.map((r) => ({
      region: r,
      country: r.slice(0, 2).toUpperCase(),
      code: r.slice(0, 2).toUpperCase(),
      continent: 'Europe',
      currency: r + '_CUR',
      sources: [],
    })),
}));

jest.mock('../../config', () => ({ config: { digestStaleMins: 30 } }));

// ── mutable store state behind a selector mock ────────────────────────
interface MockState {
  prefs: {
    selectedRegions: string[];
    headlineCount: number;
    regionHeadlineCounts: Record<string, number>;
    historyDays: number;
    showGlobalHeadlines: boolean;
    globalHeadlineCount: number;
    showCurrencyRates: boolean;
    baseCurrency: string;
  };
  screen: string;
}

let storeState: MockState;
jest.mock('../../store', () => ({
  useAppStore: <T,>(selector: (s: MockState) => T): T => selector(storeState),
}));

function setStore(overrides: { screen?: string; showCurrencyRates?: boolean } = {}) {
  storeState = {
    prefs: {
      selectedRegions: ['Hungary'],
      headlineCount: 5,
      regionHeadlineCounts: {},
      historyDays: 7,
      showGlobalHeadlines: false,
      globalHeadlineCount: 3,
      showCurrencyRates: overrides.showCurrencyRates ?? true,
      baseCurrency: 'USD',
    },
    screen: overrides.screen ?? 'digest',
  };
}

/** The `enabled` flag is the 2nd positional arg to useCurrencyRates. */
function lastEnabledArg(): boolean {
  const call = mockUseCurrencyRates.mock.calls.at(-1)!;
  return call[1] as boolean;
}

beforeEach(() => jest.clearAllMocks());

describe('useDigestPageData — currency query gating', () => {
  it('enables the currency query on the digest screen (today, rates on)', () => {
    setStore({ screen: 'digest' });
    renderHook(() => useDigestPageData('2026-06-02', true));
    expect(lastEnabledArg()).toBe(true);
  });

  it('disables the currency query while Settings is open', () => {
    setStore({ screen: 'settings' });
    renderHook(() => useDigestPageData('2026-06-02', true));
    expect(lastEnabledArg()).toBe(false);
  });

  it('stays disabled when currency rates are turned off', () => {
    setStore({ screen: 'digest', showCurrencyRates: false });
    renderHook(() => useDigestPageData('2026-06-02', true));
    expect(lastEnabledArg()).toBe(false);
  });

  it('stays disabled when viewing a non-today page', () => {
    setStore({ screen: 'digest' });
    renderHook(() => useDigestPageData('2026-05-30', false));
    expect(lastEnabledArg()).toBe(false);
  });
});
