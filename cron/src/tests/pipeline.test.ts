import { defaultConfig } from '../config';
import type { RegionDigest, DigestSource } from '../types';
import type { RegionConfig } from '../regions';
import {
  buildRunConfig,
  buildRunLog,
  usageSummary,
  retrySummary,
  runFetchPipeline,
  deduplicateAcrossDigests,
} from '../pipeline';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeDigest(overrides: Partial<RegionDigest> = {}): RegionDigest {
  return {
    region: 'Hungary',
    headlines: [],
    attempts: 1,
    usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150, costUsd: 0.001 },
    rankingUsage: { promptTokens: 20, completionTokens: 10, totalTokens: 30, costUsd: 0.0002 },
    ...overrides,
  };
}

const regions: RegionConfig[] = [
  { region: 'Hungary', country: 'HU', sources: [] },
  { region: 'United States', country: 'US', sources: [] },
];

// ── buildRunConfig ────────────────────────────────────────────────────────────

describe('buildRunConfig', () => {
  it('maps all config fields to RunConfig fields', () => {
    const rc = buildRunConfig(defaultConfig);
    expect(rc.model).toBe(defaultConfig.model.name);
    expect(rc.reasoningEffort).toBe(defaultConfig.model.reasoningEffort);
    expect(rc.temperature).toBe(defaultConfig.model.temperature);
    expect(rc.searchType).toBe(defaultConfig.model.searchType);
    expect(rc.searchContextSize).toBe(defaultConfig.model.searchContextSize);
    expect(rc.summarySentences).toBe(defaultConfig.api.fetch.summarySentences);
    expect(rc.detailSentences).toBe(defaultConfig.api.fetch.detailSentences);
    expect(rc.maxFetchAttempts).toBe(defaultConfig.api.fetch.maxAttempts);
    expect(rc.minFetchResults).toBe(defaultConfig.api.fetch.minResults);
    expect(rc.fetchBuffer).toBe(defaultConfig.api.fetch.buffer);
  });
});

// ── buildRunLog ───────────────────────────────────────────────────────────────

describe('buildRunLog', () => {
  it('aggregates token and cost totals across digests', () => {
    const digests = [makeDigest(), makeDigest({ region: 'United States' })];
    const log = buildRunLog(defaultConfig, regions, digests, Date.now() - 1000);

    expect(log.totals.promptTokens).toBe(200);
    expect(log.totals.completionTokens).toBe(100);
    expect(log.totals.totalTokens).toBe(300);
    expect(log.totals.costUsd).toBeCloseTo(0.002);
  });

  it('counts headlinesFetched as sum of all digest headline arrays', () => {
    const digests = [
      makeDigest({ headlines: [{ title: 'a', summary: '', url: '' }] }),
      makeDigest({
        headlines: [
          { title: 'b', summary: '', url: '' },
          { title: 'c', summary: '', url: '' },
        ],
      }),
    ];
    const log = buildRunLog(defaultConfig, regions, digests, Date.now());
    expect(log.totals.headlinesFetched).toBe(3);
  });

  it('computes headlinesRequested as regions * config.api.fetch.count', () => {
    const log = buildRunLog(defaultConfig, regions, [], Date.now());
    expect(log.totals.headlinesRequested).toBe(regions.length * defaultConfig.api.fetch.count);
  });

  it('includes region names from resolvedRegions', () => {
    const log = buildRunLog(defaultConfig, regions, [], Date.now());
    expect(log.regions).toEqual(['Hungary', 'United States']);
  });

  it('sets runAt to an ISO string', () => {
    const log = buildRunLog(defaultConfig, regions, [], Date.now());
    expect(() => new Date(log.runAt)).not.toThrow();
    expect(log.runAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('durationMs is non-negative', () => {
    const log = buildRunLog(defaultConfig, regions, [], Date.now() - 500);
    expect(log.totals.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('excludes digests without quality from the digests array', () => {
    const digests = [makeDigest({ quality: undefined }), makeDigest({ quality: undefined })];
    const log = buildRunLog(defaultConfig, regions, digests, Date.now());
    expect(log.digests).toHaveLength(0);
  });
});

// ── usageSummary ──────────────────────────────────────────────────────────────

describe('usageSummary', () => {
  it('formats fetch and ranking token/cost counts', () => {
    const digests = [makeDigest(), makeDigest()];
    const summary = usageSummary(digests, 3);
    expect(summary).toMatch(/^Fetch complete — 2\/3 regions/);
    expect(summary).toMatch(/fetch: 300 tokens \$0\.0020/);
    expect(summary).toMatch(/ranking: 60 tokens \$0\.0004/);
    expect(summary).toMatch(/total: \$0\.0024/);
  });

  it('handles digests without usage gracefully (treats as 0)', () => {
    const digests = [makeDigest({ usage: undefined, rankingUsage: undefined })];
    const summary = usageSummary(digests, 1);
    expect(summary).toMatch(/fetch: 0 tokens \$0\.0000/);
    expect(summary).toMatch(/ranking: 0 tokens \$0\.0000/);
  });
});

// ── retrySummary ──────────────────────────────────────────────────────────────

describe('retrySummary', () => {
  it('formats region:attempts:headlines for each digest separated by |', () => {
    const digests = [
      makeDigest({
        region: 'Hungary',
        attempts: 2,
        headlines: [{ title: 'a', summary: '', url: '' }],
      }),
      makeDigest({ region: 'United States', attempts: 1, headlines: [] }),
    ];
    expect(retrySummary(digests)).toBe('Hungary:2:1 | United States:1:0');
  });

  it('returns empty string for empty digests array', () => {
    expect(retrySummary([])).toBe('');
  });
});

// ── runFetchPipeline ──────────────────────────────────────────────────────────

describe('runFetchPipeline', () => {
  const config = {
    ...defaultConfig,
    api: {
      ...defaultConfig.api,
      regions: ['Hungary', 'United States'],
      fetch: { ...defaultConfig.api.fetch, attemptDelay: 0 },
    },
  };

  function makeSource(results: Array<RegionDigest | Error>): DigestSource {
    let i = 0;
    return {
      fetchDigest: jest.fn().mockImplementation(() => {
        const r = results[i++];
        return r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
      }),
    };
  }

  it('returns fulfilled digests and empty errors when all succeed', async () => {
    const d1 = makeDigest({ region: 'Hungary' });
    const d2 = makeDigest({ region: 'United States' });
    const result = await runFetchPipeline(config, makeSource([d1, d2]));
    expect(result.digests).toHaveLength(2);
    expect(result.errors).toHaveLength(0);
    expect(result.resolvedRegions).toHaveLength(2);
  });

  it('separates fulfilled and rejected results', async () => {
    const d1 = makeDigest({ region: 'Hungary' });
    const err = new Error('fetch failed');
    const result = await runFetchPipeline(config, makeSource([d1, err]));
    expect(result.digests).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.reason).toBe(err);
  });

  it('returns all errors when all regions fail', async () => {
    const result = await runFetchPipeline(config, makeSource([new Error('e1'), new Error('e2')]));
    expect(result.digests).toHaveLength(0);
    expect(result.errors).toHaveLength(2);
  });

  it('returns a non-negative totalDurationMs', async () => {
    const result = await runFetchPipeline(config, makeSource([makeDigest(), makeDigest()]));
    expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
  });
});

// ── deduplicateAcrossDigests ──────────────────────────────────────────────────

describe('deduplicateAcrossDigests', () => {
  const h = (url: string, imageUrl?: string) => ({
    title: 'T',
    summary: 'S',
    url,
    ...(imageUrl ? { imageUrl } : {}),
  });

  it('returns digests unchanged when all imageUrls are unique across regions', () => {
    const digests = [
      makeDigest({ region: 'Hungary', headlines: [h('a', 'https://cdn.example.com/a.jpg')] }),
      makeDigest({ region: 'UK', headlines: [h('b', 'https://cdn.example.com/b.jpg')] }),
    ];
    const result = deduplicateAcrossDigests(digests);
    expect(result[0]?.headlines[0]?.imageUrl).toBe('https://cdn.example.com/a.jpg');
    expect(result[1]?.headlines[0]?.imageUrl).toBe('https://cdn.example.com/b.jpg');
  });

  it('nulls an imageUrl that appears in two different regions', () => {
    const logo = 'https://apnews.com/hub/logo.png';
    const digests = [
      makeDigest({ region: 'Hungary', headlines: [h('a', logo)] }),
      makeDigest({ region: 'US', headlines: [h('b', logo)] }),
    ];
    const result = deduplicateAcrossDigests(digests);
    expect(result[0]?.headlines[0]?.imageUrl).toBeUndefined();
    expect(result[1]?.headlines[0]?.imageUrl).toBeUndefined();
  });

  it('preserves headlines that have no imageUrl', () => {
    const digests = [
      makeDigest({ region: 'Hungary', headlines: [h('a')] }),
      makeDigest({ region: 'US', headlines: [h('b')] }),
    ];
    const result = deduplicateAcrossDigests(digests);
    expect(result[0]?.headlines[0]?.imageUrl).toBeUndefined();
    expect(result[1]?.headlines[0]?.imageUrl).toBeUndefined();
  });

  it('only nulls cross-region duplicates, leaves unique imageUrls intact', () => {
    const logo = 'https://reuters.com/logo.png';
    const digests = [
      makeDigest({
        region: 'UK',
        headlines: [h('a', logo), h('b', 'https://cdn.bbc.co.uk/photo.jpg')],
      }),
      makeDigest({
        region: 'US',
        headlines: [h('c', logo), h('d', 'https://cdn.nyt.com/photo.jpg')],
      }),
    ];
    const result = deduplicateAcrossDigests(digests);
    expect(result[0]?.headlines[0]?.imageUrl).toBeUndefined();
    expect(result[0]?.headlines[1]?.imageUrl).toBe('https://cdn.bbc.co.uk/photo.jpg');
    expect(result[1]?.headlines[0]?.imageUrl).toBeUndefined();
    expect(result[1]?.headlines[1]?.imageUrl).toBe('https://cdn.nyt.com/photo.jpg');
  });
});
