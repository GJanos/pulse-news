import { buildCurrencyRates, fetchRates, formatRate } from '../../hooks/useCurrencyRates';

jest.mock('../../logger', () => ({
  getLogger: () => ({ info: jest.fn(), warn: jest.fn(), debug: jest.fn() }),
}));

const mockFetch = jest.fn();
global.fetch = mockFetch;

beforeEach(() => jest.clearAllMocks());

describe('fetchRates', () => {
  it('returns rates and the payload date from the first URL when it succeeds', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ date: '2026-06-01', usd: { eur: 0.9, gbp: 0.8 } }),
    });
    const result = await fetchRates('USD', 'latest');
    expect(result?.rates).toEqual({ eur: 0.9, gbp: 0.8 });
    expect(result?.date).toBe('2026-06-01');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('returns an empty date when the payload omits one', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ usd: { eur: 0.9 } }),
    });
    const result = await fetchRates('USD', 'latest');
    expect(result?.rates).toEqual({ eur: 0.9 });
    expect(result?.date).toBe('');
  });

  it('falls back to second URL when first returns non-ok', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 500, json: jest.fn() })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ usd: { eur: 0.9 } }) });
    const result = await fetchRates('USD', 'latest');
    expect(result?.rates).toEqual({ eur: 0.9 });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('returns null when both URLs fail with network error', async () => {
    mockFetch.mockRejectedValue(new Error('network'));
    const result = await fetchRates('USD', 'latest');
    expect(result).toBeNull();
  });

  it('returns null when first URL throws and second returns non-ok', async () => {
    mockFetch
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ ok: false, status: 503, json: jest.fn() });
    const result = await fetchRates('USD', 'latest');
    expect(result).toBeNull();
  });

  it('returns null when response has no key matching the base currency', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ eur: { usd: 1.1 } }), // key is 'eur', not 'usd'
    });
    const result = await fetchRates('USD', 'latest');
    // json[key] where key='usd' not found → null
    expect(result).toBeNull();
  });
});

describe('buildCurrencyRates', () => {
  it('returns {} when today fetch fails', async () => {
    mockFetch.mockRejectedValue(new Error('network'));
    const result = await buildCurrencyRates(['EUR'], 'USD');
    expect(result).toEqual({});
  });

  it('builds rate with positive changePercent when EUR strengthened vs USD', async () => {
    // today: 0.9 EUR per USD; yesterday: 1.0 EUR per USD
    // prevRate=1.0, rate=0.9 → change=(1.0-0.9)/1.0*100=10%
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ usd: { eur: 0.9 } }) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ usd: { eur: 1.0 } }) });
    const result = await buildCurrencyRates(['EUR'], 'USD');
    expect(result['EUR']!.rate).toBeCloseTo(0.9);
    expect(result['EUR']!.changePercent).toBeCloseTo(10);
  });

  it('anchors yesterday to the latest payload date, not the device clock', async () => {
    // Guards the CDN-lag regression: when @latest lags the device clock, a
    // clock-derived yesterday collides with latest and reports a flat 0%.
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ date: '2026-05-31', usd: { eur: 0.9 } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ date: '2026-05-30', usd: { eur: 1.0 } }),
      });
    await buildCurrencyRates(['EUR'], 'USD');
    const yesterdayUrl = mockFetch.mock.calls[1]![0] as string;
    expect(yesterdayUrl).toContain('2026-05-30');
    expect(yesterdayUrl).not.toContain('2026-05-31');
  });

  it('sets changePercent null when yesterday unavailable (both fallbacks fail)', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ usd: { eur: 0.9 } }) })
      .mockRejectedValueOnce(new Error('network'))
      .mockRejectedValueOnce(new Error('network'));
    const result = await buildCurrencyRates(['EUR'], 'USD');
    expect(result['EUR']!.changePercent).toBeNull();
  });

  it('skips baseCurrency code from output', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ usd: { eur: 0.9, usd: 1.0 } }),
      })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ usd: {} }) });
    const result = await buildCurrencyRates(['EUR', 'USD'], 'USD');
    expect('USD' in result).toBe(false);
    expect('EUR' in result).toBe(true);
  });

  it('excludes code not present in today rates', async () => {
    // today rates have EUR but not GBP
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ usd: { eur: 0.9 } }), // no gbp
      })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ usd: {} }) });
    const result = await buildCurrencyRates(['EUR', 'GBP'], 'USD');
    expect('EUR' in result).toBe(true);
    expect('GBP' in result).toBe(false);
  });

  it('two independent calls make separate network requests (no shared memoization)', async () => {
    // Use persistent mock so both calls hit the network cleanly without fallbacks
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ eur: { usd: 1.1 } }),
    });
    await buildCurrencyRates(['USD'], 'EUR');
    await buildCurrencyRates(['USD'], 'EUR');
    // Each call makes exactly 2 fetch requests (today + yesterday), total = 4
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });
});

describe('formatRate', () => {
  it.each([
    // ≥ 10_000 → localized integer
    [15000, '15,000'],
    [10000, '10,000'],
    // ≥ 100 → plain integer
    [150, '150'],
    [100, '100'],
    // ≥ 10 → 2 decimal places
    [15.5, '15.50'],
    [10.0, '10.00'],
    // ≥ 1 → 3 decimal places
    [1.234, '1.234'],
    [1.0, '1.000'],
    // < 1 → 3 decimal places
    [0.001, '0.001'],
    [0.9, '0.900'],
  ])('formatRate(%s) = %s', (input, expected) => {
    expect(formatRate(input)).toBe(expected);
  });
});
