import {
  loadDailyDigest,
  loadGlobalHeadlines,
  loadLocalRegionDigest,
  saveLocalRegionDigest,
  trimLocalCache,
  fetchRemoteDigestsForDate,
} from '../../storage/digests';
import { storage } from '../../storage/mmkv';
import { getSupabase } from '../../supabase/client';

// clearAll is a test-only helper added by the MMKV mock — not part of the real MMKV type
const testStorage = storage as unknown as { clearAll(): void };

jest.mock('../../supabase/client', () => ({ getSupabase: jest.fn() }));
jest.mock('../../logger', () => ({
  getLogger: () => ({ info: jest.fn(), warn: jest.fn(), debug: jest.fn() }),
}));

const TODAY = new Date().toISOString().slice(0, 10);
const PAST = '2020-01-01';

function mockSupabase(rows: unknown[] | null, error: unknown = null) {
  const chain = {
    from: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockResolvedValue({ data: rows, error }),
    maybeSingle: jest.fn().mockResolvedValue({ data: rows?.[0] ?? null, error }),
  };
  jest.mocked(getSupabase).mockReturnValue(chain as unknown as ReturnType<typeof getSupabase>);
  return chain;
}

beforeEach(() => {
  testStorage.clearAll();
  jest.clearAllMocks();
});

// ── loadDailyDigest ──────────────────────────────────────────────────

describe('loadDailyDigest — today', () => {
  it('all regions fresh — Supabase not called', async () => {
    saveLocalRegionDigest('Hungary', TODAY, [{ title: 'A', summary: 'S', url: 'u' }]);
    const chain = mockSupabase([]);
    const result = await loadDailyDigest(TODAY, ['Hungary'], { staleMinutes: 60 });
    expect(result.regions['Hungary']).toHaveLength(1);
    expect(chain.in).not.toHaveBeenCalled();
  });

  it('stale region fetched from Supabase and written to MMKV', async () => {
    const staleEntry = JSON.stringify({
      region: 'Hungary',
      date: TODAY,
      headlines: [{ title: 'old', summary: 's', url: 'u' }],
      cachedAt: new Date(0).toISOString(),
    });
    storage.set(`pulse.digest.v1::${TODAY}::Hungary`, staleEntry);
    mockSupabase([
      { region: 'Hungary', payload: { headlines: [{ title: 'new', summary: 's', url: 'u' }] } },
    ]);
    const result = await loadDailyDigest(TODAY, ['Hungary'], { staleMinutes: 60 });
    expect(result.regions['Hungary']![0]!.title).toBe('new');
  });

  it('all missing — all fetched and written to MMKV', async () => {
    mockSupabase([
      { region: 'Hungary', payload: { headlines: [{ title: 'HU', summary: 's', url: 'u' }] } },
      { region: 'Ukraine', payload: { headlines: [{ title: 'UA', summary: 's', url: 'u' }] } },
    ]);
    const result = await loadDailyDigest(TODAY, ['Hungary', 'Ukraine'], { staleMinutes: 60 });
    expect(Object.keys(result.regions)).toHaveLength(2);
    expect(storage.getString(`pulse.digest.v1::${TODAY}::Hungary`)).toBeDefined();
  });

  it('Supabase returns empty — stale MMKV served (offline fallback)', async () => {
    const staleEntry = JSON.stringify({
      region: 'Hungary',
      date: TODAY,
      headlines: [{ title: 'stale', summary: 's', url: 'u' }],
      cachedAt: new Date(0).toISOString(),
    });
    storage.set(`pulse.digest.v1::${TODAY}::Hungary`, staleEntry);
    mockSupabase([]);
    const result = await loadDailyDigest(TODAY, ['Hungary'], { staleMinutes: 0 });
    expect(result.regions['Hungary']![0]!.title).toBe('stale');
  });

  it('Supabase error — stale MMKV served', async () => {
    const staleEntry = JSON.stringify({
      region: 'Hungary',
      date: TODAY,
      headlines: [{ title: 'cached', summary: 's', url: 'u' }],
      cachedAt: new Date(0).toISOString(),
    });
    storage.set(`pulse.digest.v1::${TODAY}::Hungary`, staleEntry);
    mockSupabase(null, { message: 'network error' });
    const result = await loadDailyDigest(TODAY, ['Hungary'], { staleMinutes: 0 });
    expect(result.regions['Hungary']![0]!.title).toBe('cached');
  });
});

// ── loadDailyDigest — empty today does not block refetch ─────────────
// Regression guard (Slice 1, item 3): an empty "today" must never be cached
// in a way that prevents a later repull, and forceRefresh must always re-pull.

describe('loadDailyDigest — empty today does not block refetch', () => {
  it('a region with no remote row is never cached, so the next load refetches', async () => {
    const chain = mockSupabase([]); // Supabase returns no row for the region
    const first = await loadDailyDigest(TODAY, ['Hungary'], { staleMinutes: 60 });
    // absent from the digest and never written to MMKV → nothing to poison
    expect(first.regions['Hungary']).toBeUndefined();
    expect(storage.getString(`pulse.digest.v1::${TODAY}::Hungary`)).toBeUndefined();
    // still treated as stale (uncached) on the next load → Supabase queried again
    await loadDailyDigest(TODAY, ['Hungary'], { staleMinutes: 60 });
    expect(chain.in).toHaveBeenCalledTimes(2);
  });

  it('forceRefresh (staleMinutes: 0) repulls a previously cached today region', async () => {
    // A region cached on an earlier load (cachedAt in the past), as in the real
    // forceRefresh path. staleMinutes:0 makes any prior cache stale → repull.
    storage.set(
      `pulse.digest.v1::${TODAY}::Hungary`,
      JSON.stringify({
        region: 'Hungary',
        date: TODAY,
        headlines: [{ title: 'cached', summary: 's', url: 'u' }],
        cachedAt: new Date(Date.now() - 60_000).toISOString(),
      }),
    );
    const chain = mockSupabase([
      { region: 'Hungary', payload: { headlines: [{ title: 'fresh', summary: 's', url: 'u' }] } },
    ]);
    const result = await loadDailyDigest(TODAY, ['Hungary'], { staleMinutes: 0 });
    expect(chain.in).toHaveBeenCalledWith('region', ['Hungary']);
    expect(result.regions['Hungary']![0]!.title).toBe('fresh');
  });
});

describe('loadDailyDigest — past date', () => {
  it('cache hit — immutable, no Supabase call', async () => {
    saveLocalRegionDigest('Hungary', PAST, [{ title: 'Past', summary: 's', url: 'u' }]);
    const chain = mockSupabase([]);
    const result = await loadDailyDigest(PAST, ['Hungary']);
    expect(result.regions['Hungary']).toHaveLength(1);
    expect(chain.in).not.toHaveBeenCalled();
  });

  it('cache miss — fetched once then written through', async () => {
    mockSupabase([
      { region: 'Hungary', payload: { headlines: [{ title: 'fetched', summary: 's', url: 'u' }] } },
    ]);
    const result = await loadDailyDigest(PAST, ['Hungary']);
    expect(result.regions['Hungary']![0]!.title).toBe('fetched');
    expect(storage.getString(`pulse.digest.v1::${PAST}::Hungary`)).toBeDefined();
  });
});

// ── saveLocalRegionDigest ────────────────────────────────────────────

describe('saveLocalRegionDigest', () => {
  it('write + read roundtrip', async () => {
    saveLocalRegionDigest('Ukraine', TODAY, [{ title: 'T', summary: 'S', url: 'u' }]);
    const result = await loadDailyDigest(TODAY, ['Ukraine'], { staleMinutes: 9999 });
    expect(result.regions['Ukraine']).toHaveLength(1);
  });
});

// ── trimLocalCache ───────────────────────────────────────────────────

describe('trimLocalCache', () => {
  it('entry on exact cutoff date kept; day before dropped', () => {
    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - 7);
    const cutoffISO = cutoff.toISOString().slice(0, 10);
    const dayBefore = new Date(cutoff.getTime() - 86_400_000).toISOString().slice(0, 10);
    saveLocalRegionDigest('Hungary', cutoffISO, []);
    saveLocalRegionDigest('Hungary', dayBefore, []);
    trimLocalCache(7);
    expect(storage.getString(`pulse.digest.v1::${cutoffISO}::Hungary`)).toBeDefined();
    expect(storage.getString(`pulse.digest.v1::${dayBefore}::Hungary`)).toBeUndefined();
  });
});

// ── loadLocalRegionDigest ────────────────────────────────────────────

describe('loadLocalRegionDigest', () => {
  it('cache miss — returns null', async () => {
    const result = await loadLocalRegionDigest('Hungary', TODAY);
    expect(result).toBeNull();
  });

  it('cache hit — returns headlines array', async () => {
    saveLocalRegionDigest('Hungary', TODAY, [{ title: 'T', summary: 'S', url: 'u' }]);
    const result = await loadLocalRegionDigest('Hungary', TODAY);
    expect(result).toHaveLength(1);
    expect(result![0]!.title).toBe('T');
  });

  it('corrupt JSON — returns null (graceful error handling)', async () => {
    storage.set(`pulse.digest.v1::${TODAY}::Hungary`, 'not-json{{{');
    const result = await loadLocalRegionDigest('Hungary', TODAY);
    expect(result).toBeNull();
  });
});

// ── fetchRemoteDigestsForDate ────────────────────────────────────────

describe('fetchRemoteDigestsForDate', () => {
  it('empty regions array — returns [] without calling Supabase', async () => {
    const chain = mockSupabase([]);
    const result = await fetchRemoteDigestsForDate(TODAY, []);
    expect(result).toEqual([]);
    expect(chain.in).not.toHaveBeenCalled();
  });

  it('Supabase not configured — returns []', async () => {
    jest.mocked(getSupabase).mockReturnValue(null);
    const result = await fetchRemoteDigestsForDate(TODAY, ['Hungary']);
    expect(result).toEqual([]);
  });

  it('normal fetch — maps region + headlines correctly', async () => {
    mockSupabase([
      { region: 'Hungary', payload: { headlines: [{ title: 'H', summary: 's', url: 'u' }] } },
    ]);
    const result = await fetchRemoteDigestsForDate(TODAY, ['Hungary']);
    expect(result).toHaveLength(1);
    expect(result[0]!.region).toBe('Hungary');
    expect(result[0]!.headlines[0]!.title).toBe('H');
  });

  it('Supabase error — returns []', async () => {
    mockSupabase(null, { message: 'network error' });
    const result = await fetchRemoteDigestsForDate(TODAY, ['Hungary']);
    expect(result).toEqual([]);
  });

  it('row with missing payload.headlines — defaults to []', async () => {
    mockSupabase([{ region: 'Hungary', payload: {} }]);
    const result = await fetchRemoteDigestsForDate(TODAY, ['Hungary']);
    expect(result[0]!.headlines).toEqual([]);
  });
});

// ── loadDailyDigest — mixed fresh/stale ─────────────────────────────

describe('loadDailyDigest — mixed fresh and stale regions', () => {
  it('only stale region is passed to Supabase .in()', async () => {
    saveLocalRegionDigest('Hungary', TODAY, [{ title: 'fresh-hu', summary: 's', url: 'u' }]);
    const staleEntry = JSON.stringify({
      region: 'Ukraine',
      date: TODAY,
      headlines: [{ title: 'old-ua', summary: 's', url: 'u' }],
      cachedAt: new Date(0).toISOString(),
    });
    storage.set(`pulse.digest.v1::${TODAY}::Ukraine`, staleEntry);
    const chain = mockSupabase([
      { region: 'Ukraine', payload: { headlines: [{ title: 'new-ua', summary: 's', url: 'u' }] } },
    ]);
    const result = await loadDailyDigest(TODAY, ['Hungary', 'Ukraine'], { staleMinutes: 60 });
    expect(result.regions['Hungary']![0]!.title).toBe('fresh-hu');
    expect(result.regions['Ukraine']![0]!.title).toBe('new-ua');
    expect(chain.in).toHaveBeenCalledWith('region', ['Ukraine']);
  });
});

// ── trimLocalCache — additional ──────────────────────────────────────

describe('trimLocalCache — additional', () => {
  it('empty cache — no-op, does not throw', () => {
    expect(() => trimLocalCache(7)).not.toThrow();
  });

  it('global cache keys are not affected by trim', () => {
    const oldDate = '2000-01-01';
    storage.set(
      `pulse.global.v1::${oldDate}`,
      JSON.stringify({ date: oldDate, headlines: [], cachedAt: new Date(0).toISOString() }),
    );
    trimLocalCache(7);
    expect(storage.getString(`pulse.global.v1::${oldDate}`)).toBeDefined();
  });

  it("today's entry is never trimmed", () => {
    saveLocalRegionDigest('Hungary', TODAY, []);
    trimLocalCache(7);
    expect(storage.getString(`pulse.digest.v1::${TODAY}::Hungary`)).toBeDefined();
  });
});

// ── loadDailyDigest — historyDays trim scoping ───────────────────────

describe('loadDailyDigest — historyDays trim scoping', () => {
  it('historyDays triggers trim when loading today', async () => {
    const oldDate = '2000-01-01';
    saveLocalRegionDigest('Hungary', oldDate, []);
    mockSupabase([]);
    await loadDailyDigest(TODAY, [], { historyDays: 7 });
    expect(storage.getString(`pulse.digest.v1::${oldDate}::Hungary`)).toBeUndefined();
  });

  it('historyDays does NOT trigger trim when loading a past date', async () => {
    const oldDate = '2000-01-01';
    saveLocalRegionDigest('Hungary', oldDate, []);
    mockSupabase([]);
    await loadDailyDigest(PAST, [], { historyDays: 7 });
    expect(storage.getString(`pulse.digest.v1::${oldDate}::Hungary`)).toBeDefined();
  });
});

// ── loadGlobalHeadlines — past date ──────────────────────────────────

describe('loadGlobalHeadlines — past date', () => {
  it('past date cached entry served regardless of age (immutable)', async () => {
    const entry = JSON.stringify({
      date: PAST,
      headlines: [{ title: 'old-global', summary: 's', url: 'u', region: 'H' }],
      cachedAt: new Date(0).toISOString(),
    });
    storage.set(`pulse.global.v1::${PAST}`, entry);
    const chain = mockSupabase([]);
    const result = await loadGlobalHeadlines(PAST);
    expect(result[0]!.title).toBe('old-global');
    expect(chain.maybeSingle).not.toHaveBeenCalled();
  });

  it('past date cache miss — fetches from Supabase', async () => {
    mockSupabase([
      { payload: { headlines: [{ title: 'past-global', summary: 's', url: 'u', region: 'H' }] } },
    ]);
    const result = await loadGlobalHeadlines(PAST);
    expect(result[0]!.title).toBe('past-global');
  });

  it('Supabase returns no row — returns empty array', async () => {
    mockSupabase([]); // maybeSingle resolves {data: null, error: null}
    const result = await loadGlobalHeadlines(TODAY, { staleMinutes: 0 });
    expect(result).toEqual([]);
  });
});

// ── loadGlobalHeadlines ──────────────────────────────────────────────

describe('loadGlobalHeadlines', () => {
  it('cache miss — fetches from Supabase global_digests', async () => {
    mockSupabase([
      { payload: { headlines: [{ title: 'G', summary: 's', url: 'u', region: 'Hungary' }] } },
    ]);
    const result = await loadGlobalHeadlines(TODAY, { staleMinutes: 60 });
    expect(result).toHaveLength(1);
    expect(result[0]!.title).toBe('G');
  });

  it('cache hit within stale window — Supabase not called', async () => {
    const entry = JSON.stringify({
      date: TODAY,
      headlines: [{ title: 'cached', summary: 's', url: 'u', region: 'H' }],
      cachedAt: new Date().toISOString(),
    });
    storage.set(`pulse.global.v1::${TODAY}`, entry);
    const chain = mockSupabase([]);
    const result = await loadGlobalHeadlines(TODAY, { staleMinutes: 60 });
    expect(result[0]!.title).toBe('cached');
    expect(chain.maybeSingle).not.toHaveBeenCalled();
  });

  it('Supabase error — returns empty array', async () => {
    mockSupabase(null, { message: 'err' });
    const result = await loadGlobalHeadlines(TODAY, { staleMinutes: 0 });
    expect(result).toEqual([]);
  });
});
