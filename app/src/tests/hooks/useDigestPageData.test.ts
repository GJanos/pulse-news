import { buildVisibleBuckets, clampGlobalHeadlineCount } from '../../hooks/useDigestPageData';
import type { DailyDigest, Headline } from '../../types';

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
  TODAY_ISO: '2026-01-01',
  isoDateAtDayIndex: jest.fn(),
  formatLongDate: jest.fn(),
  REGIONS: [],
}));

// ── helpers ──────────────────────────────────────────────────────────

function makeHeadlines(count: number, prefix = 'H'): Headline[] {
  return Array.from({ length: count }, (_, i) => ({
    title: `${prefix}-${i}`,
    summary: `summary ${i}`,
    url: `https://example.com/${prefix}/${i}`,
  }));
}

function makeDigest(regionCounts: Record<string, number>): DailyDigest {
  return {
    date: '2026-01-01',
    regions: Object.fromEntries(
      Object.entries(regionCounts).map(([r, n]) => [r, makeHeadlines(n, r)]),
    ),
  };
}

// ── basic filtering ───────────────────────────────────────────────────

describe('buildVisibleBuckets — basic filtering', () => {
  it('returns only the selectedRegions that are in the digest', () => {
    const d = makeDigest({ Hungary: 3, Ukraine: 2, Russia: 1 });
    const result = buildVisibleBuckets(d, ['Hungary', 'Ukraine'], 5, {});
    expect(result.map((b) => b.region.region)).toEqual(['Hungary', 'Ukraine']);
  });

  it('empty selectedRegions → []', () => {
    const d = makeDigest({ Hungary: 3 });
    expect(buildVisibleBuckets(d, [], 5, {})).toEqual([]);
  });

  it('undefined digest → []', () => {
    expect(buildVisibleBuckets(undefined, ['Hungary'], 5, {})).toEqual([]);
  });

  it('digest with no matching selectedRegions → []', () => {
    const d = makeDigest({ Russia: 2 });
    const result = buildVisibleBuckets(d, ['Hungary', 'Ukraine'], 5, {});
    expect(result).toEqual([]);
  });

  it('region in selectedRegions but absent from digest is silently dropped', () => {
    const d = makeDigest({ Hungary: 2 });
    const result = buildVisibleBuckets(d, ['Hungary', 'Ukraine'], 5, {});
    expect(result).toHaveLength(1);
    expect(result[0]!.region.region).toBe('Hungary');
  });

  it('region in digest with empty array → excluded from visible', () => {
    const d: DailyDigest = { date: '2026-01-01', regions: { Hungary: [], Ukraine: [] } };
    const result = buildVisibleBuckets(d, ['Hungary', 'Ukraine'], 5, {});
    expect(result).toEqual([]);
  });
});

// ── ordering ──────────────────────────────────────────────────────────

describe('buildVisibleBuckets — ordering', () => {
  it('preserves the exact order from sortedSelectedRegions', () => {
    const d = makeDigest({ Ukraine: 2, Hungary: 3, Russia: 1 });
    const result = buildVisibleBuckets(d, ['Ukraine', 'Hungary', 'Russia'], 5, {});
    expect(result.map((b) => b.region.region)).toEqual(['Ukraine', 'Hungary', 'Russia']);
  });

  it('single region is returned as-is', () => {
    const d = makeDigest({ Hungary: 2 });
    const result = buildVisibleBuckets(d, ['Hungary'], 5, {});
    expect(result).toHaveLength(1);
  });
});

// ── headline count caps ───────────────────────────────────────────────

describe('buildVisibleBuckets — headline count caps', () => {
  it('respects global headlineCount cap', () => {
    const d = makeDigest({ Hungary: 10 });
    const result = buildVisibleBuckets(d, ['Hungary'], 3, {});
    expect(result[0]!.items).toHaveLength(3);
  });

  it('fewer headlines than cap → shows all available', () => {
    const d = makeDigest({ Hungary: 2 });
    const result = buildVisibleBuckets(d, ['Hungary'], 10, {});
    expect(result[0]!.items).toHaveLength(2);
  });

  it('headlineCount exactly matches available → shows all', () => {
    const d = makeDigest({ Hungary: 5 });
    const result = buildVisibleBuckets(d, ['Hungary'], 5, {});
    expect(result[0]!.items).toHaveLength(5);
  });

  it('regionHeadlineCounts override takes precedence over headlineCount', () => {
    const d = makeDigest({ Hungary: 10 });
    const result = buildVisibleBuckets(d, ['Hungary'], 5, { Hungary: 2 });
    expect(result[0]!.items).toHaveLength(2);
  });

  it('regionHeadlineCounts: 0 → bucket has 0 items → excluded from visible', () => {
    const d = makeDigest({ Hungary: 10 });
    const result = buildVisibleBuckets(d, ['Hungary'], 5, { Hungary: 0 });
    expect(result).toEqual([]);
  });

  it('mix of overridden and default counts', () => {
    const d = makeDigest({ Hungary: 10, Ukraine: 10, Russia: 10 });
    const result = buildVisibleBuckets(d, ['Hungary', 'Ukraine', 'Russia'], 5, { Ukraine: 2 });
    const hu = result.find((b) => b.region.region === 'Hungary')!;
    const ua = result.find((b) => b.region.region === 'Ukraine')!;
    const ru = result.find((b) => b.region.region === 'Russia')!;
    expect(hu.items).toHaveLength(5); // uses global headlineCount
    expect(ua.items).toHaveLength(2); // uses override
    expect(ru.items).toHaveLength(5); // uses global headlineCount
  });

  it('regionHeadlineCounts larger than available → shows all available', () => {
    const d = makeDigest({ Hungary: 3 });
    const result = buildVisibleBuckets(d, ['Hungary'], 5, { Hungary: 99 });
    expect(result[0]!.items).toHaveLength(3);
  });
});

// ── items content correctness ─────────────────────────────────────────

describe('buildVisibleBuckets — items content', () => {
  it('items array preserves original headline data', () => {
    const headlines: Headline[] = [
      { title: 'Breaking', summary: 'Details here', url: 'https://x.com', sourceName: 'BBC' },
    ];
    const d: DailyDigest = { date: '2026-01-01', regions: { Hungary: headlines } };
    const result = buildVisibleBuckets(d, ['Hungary'], 5, {});
    expect(result[0]!.items[0]).toEqual(headlines[0]);
  });

  it('items are taken from the front of the digest array (slice, not sort)', () => {
    const d = makeDigest({ Hungary: 5 });
    const result = buildVisibleBuckets(d, ['Hungary'], 3, {});
    expect(result[0]!.items[0]!.title).toBe('Hungary-0');
    expect(result[0]!.items[2]!.title).toBe('Hungary-2');
  });

  it('region object on each bucket matches the Region from data.ts', () => {
    const d = makeDigest({ Hungary: 1 });
    const result = buildVisibleBuckets(d, ['Hungary'], 5, {});
    expect(result[0]!.region).toMatchObject({
      region: 'Hungary',
      currency: 'Hungary_CUR',
    });
  });
});

// ── global headline count clamp ───────────────────────────────────────

describe('clampGlobalHeadlineCount', () => {
  it('clamps a stored value above the max down to the max', () => {
    expect(clampGlobalHeadlineCount(10, 5)).toBe(5);
  });

  it('passes through a stored value within the cap', () => {
    expect(clampGlobalHeadlineCount(3, 5)).toBe(3);
  });

  it('passes through a stored value equal to the cap', () => {
    expect(clampGlobalHeadlineCount(5, 5)).toBe(5);
  });
});

// ── cross-bucket aggregation ──────────────────────────────────────────

describe('buildVisibleBuckets — cross-bucket aggregation', () => {
  it('total items across all buckets is correct', () => {
    const d = makeDigest({ Hungary: 3, Ukraine: 2, Russia: 1 });
    const result = buildVisibleBuckets(d, ['Hungary', 'Ukraine', 'Russia'], 5, {});
    const total = result.reduce((n, b) => n + b.items.length, 0);
    expect(total).toBe(6);
  });

  it('total with caps applied across mixed regions', () => {
    const d = makeDigest({ Hungary: 10, Ukraine: 10 });
    const result = buildVisibleBuckets(d, ['Hungary', 'Ukraine'], 3, {});
    const total = result.reduce((n, b) => n + b.items.length, 0);
    expect(total).toBe(6); // 3 + 3
  });

  it('all regions excluded produces zero total', () => {
    const d: DailyDigest = { date: '2026-01-01', regions: { Hungary: [], Ukraine: [] } };
    const result = buildVisibleBuckets(d, ['Hungary', 'Ukraine'], 5, {});
    const total = result.reduce((n, b) => n + b.items.length, 0);
    expect(total).toBe(0);
  });
});
