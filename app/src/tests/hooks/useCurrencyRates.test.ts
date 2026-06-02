import { buildCurrencyRates, fetchRates, formatRate } from '../../hooks/useCurrencyRates';

jest.mock('../../logger', () => ({
  getLogger: () => ({ info: jest.fn(), warn: jest.fn(), debug: jest.fn() }),
}));

const mockFetch = jest.fn();
global.fetch = mockFetch;

beforeEach(() => jest.clearAllMocks());

/** Build a Frankfurter v2 array response for a base and a quote→rate map. */
function v2(date: string, base: string, rates: Record<string, number>) {
  return Object.entries(rates).map(([quote, rate]) => ({ date, base, quote, rate }));
}

function okJson(body: unknown) {
  return { ok: true, json: () => Promise.resolve(body) };
}

describe('fetchRates', () => {
  it('builds the v2 latest URL with uppercase base + quotes and reduces the array', async () => {
    mockFetch.mockResolvedValueOnce(okJson(v2('2026-06-02', 'USD', { EUR: 0.85, GBP: 0.74 })));
    const result = await fetchRates('usd', ['eur', 'gbp'], 'latest');
    const url = mockFetch.mock.calls[0]![0] as string;
    expect(url).toContain('https://api.frankfurter.dev/v2/rates');
    expect(url).toContain('base=USD');
    expect(url).toContain('quotes=EUR,GBP');
    expect(url).not.toContain('date=');
    expect(result?.rates).toEqual({ EUR: 0.85, GBP: 0.74 });
    expect(result?.date).toBe('2026-06-02');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('includes the date param for a dated (prior-day) request', async () => {
    mockFetch.mockResolvedValueOnce(okJson(v2('2026-05-30', 'USD', { EUR: 0.86 })));
    await fetchRates('USD', ['EUR'], '2026-05-30');
    const url = mockFetch.mock.calls[0]![0] as string;
    expect(url).toContain('date=2026-05-30');
    expect(url).toContain('base=USD');
    expect(url).toContain('quotes=EUR');
  });

  it('returns an empty rates map and empty date for an empty array', async () => {
    mockFetch.mockResolvedValueOnce(okJson([]));
    const result = await fetchRates('USD', ['EUR'], 'latest');
    expect(result?.rates).toEqual({});
    expect(result?.date).toBe('');
  });

  it('returns null when the response is non-ok (single origin, no mirror)', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500, json: jest.fn() });
    const result = await fetchRates('USD', ['EUR'], 'latest');
    expect(result).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('returns null on a network error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network'));
    const result = await fetchRates('USD', ['EUR'], 'latest');
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
      .mockResolvedValueOnce(okJson(v2('2026-06-02', 'USD', { EUR: 0.9 })))
      .mockResolvedValueOnce(okJson(v2('2026-06-01', 'USD', { EUR: 1.0 })));
    const result = await buildCurrencyRates(['EUR'], 'USD');
    expect(result['EUR']!.rate).toBeCloseTo(0.9);
    expect(result['EUR']!.changePercent).toBeCloseTo(10);
  });

  it('looks up rates case-insensitively (uppercase quote keys)', async () => {
    mockFetch
      .mockResolvedValueOnce(okJson(v2('2026-06-02', 'USD', { EUR: 0.9 })))
      .mockResolvedValueOnce(okJson(v2('2026-06-01', 'USD', { EUR: 1.0 })));
    const result = await buildCurrencyRates(['eur'], 'usd');
    expect(result['eur']!.rate).toBeCloseTo(0.9);
  });

  it('anchors yesterday to the latest payload date, not the device clock', async () => {
    mockFetch
      .mockResolvedValueOnce(okJson(v2('2026-05-31', 'USD', { EUR: 0.9 })))
      .mockResolvedValueOnce(okJson(v2('2026-05-30', 'USD', { EUR: 1.0 })));
    await buildCurrencyRates(['EUR'], 'USD');
    const yesterdayUrl = mockFetch.mock.calls[1]![0] as string;
    expect(yesterdayUrl).toContain('date=2026-05-30');
    expect(yesterdayUrl).not.toContain('date=2026-05-31');
  });

  it('sets changePercent null when yesterday unavailable', async () => {
    mockFetch
      .mockResolvedValueOnce(okJson(v2('2026-06-02', 'USD', { EUR: 0.9 })))
      .mockRejectedValueOnce(new Error('network'));
    const result = await buildCurrencyRates(['EUR'], 'USD');
    expect(result['EUR']!.changePercent).toBeNull();
  });

  it('skips baseCurrency code from output and excludes it from the quotes list', async () => {
    mockFetch
      .mockResolvedValueOnce(okJson(v2('2026-06-02', 'USD', { EUR: 0.9 })))
      .mockResolvedValueOnce(okJson(v2('2026-06-01', 'USD', { EUR: 1.0 })));
    const result = await buildCurrencyRates(['EUR', 'USD'], 'USD');
    expect('USD' in result).toBe(false);
    expect('EUR' in result).toBe(true);
    const todayUrl = mockFetch.mock.calls[0]![0] as string;
    expect(todayUrl).toContain('quotes=EUR');
    expect(todayUrl).not.toContain('USD,');
    expect(todayUrl).not.toContain(',USD');
  });

  it('returns {} without any fetch when every requested code is the base', async () => {
    const result = await buildCurrencyRates(['USD'], 'usd');
    expect(result).toEqual({});
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('excludes a code not present in today rates', async () => {
    mockFetch
      .mockResolvedValueOnce(okJson(v2('2026-06-02', 'USD', { EUR: 0.9 }))) // no GBP
      .mockResolvedValueOnce(okJson(v2('2026-06-01', 'USD', { EUR: 1.0 })));
    const result = await buildCurrencyRates(['EUR', 'GBP'], 'USD');
    expect('EUR' in result).toBe(true);
    expect('GBP' in result).toBe(false);
  });

  it('two independent calls make separate network requests (no shared memoization)', async () => {
    mockFetch.mockResolvedValue(okJson(v2('2026-06-02', 'EUR', { USD: 1.1 })));
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
