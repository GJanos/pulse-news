import { defaultConfig } from '../config';
import type { RegionDigest, DigestUsage, DigestQuality } from '../types';
import type { RegionConfig } from '../regions';
import {
  buildRunReport,
  formatRunReportSummary,
  persistRunReport,
  type BuildRunReportArgs,
} from '../runReport';

// buildClient is mocked so persistRunReport never touches firebase-admin / Supabase.
const mockInsert = jest.fn();
jest.mock('../notify', () => ({
  buildClient: () => ({ from: () => ({ insert: mockInsert }) }),
}));

jest.mock('../logging', () => ({
  getLogger: () => ({ info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() }),
  formatError: (e: unknown) => String(e),
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const fetchUsage: DigestUsage = {
  promptTokens: 100,
  completionTokens: 50,
  totalTokens: 150,
  costUsd: 0.001,
};
const rankUsage: DigestUsage = {
  promptTokens: 20,
  completionTokens: 10,
  totalTokens: 30,
  costUsd: 0.0002,
};
const globalUsage: DigestUsage = {
  promptTokens: 200,
  completionTokens: 30,
  totalTokens: 230,
  costUsd: 0.005,
};

const regions: RegionConfig[] = [
  { region: 'Hungary', country: 'HU', sources: [] },
  { region: 'United States', country: 'US', sources: [] },
];

function makeDigest(overrides: Partial<RegionDigest> = {}): RegionDigest {
  return {
    region: 'Hungary',
    headlines: [],
    attempts: 1,
    usage: fetchUsage,
    rankingUsage: rankUsage,
    ...overrides,
  };
}

function makeArgs(overrides: Partial<BuildRunReportArgs> = {}): BuildRunReportArgs {
  return {
    config: defaultConfig,
    resolvedRegions: regions,
    digests: [
      makeDigest({ region: 'Hungary', headlines: [{ title: 'a', summary: '', url: '' }] }),
      makeDigest({
        region: 'United States',
        headlines: [
          { title: 'b', summary: '', url: '' },
          { title: 'c', summary: '', url: '' },
        ],
      }),
    ],
    errors: [],
    startTime: Date.now() - 1000,
    globalRankingUsage: globalUsage,
    notify: { devicesTargeted: 10, sent: 8, failed: 2 },
    ...overrides,
  };
}

// ── buildRunReport ──────────────────────────────────────────────────────────

describe('buildRunReport', () => {
  it('aggregates fetch cost across digests', () => {
    const report = buildRunReport(makeArgs());
    expect(report.cost.fetch.totalTokens).toBe(300); // 150 × 2
    expect(report.cost.fetch.costUsd).toBeCloseTo(0.002);
  });

  it('aggregates ranking cost from per-region ranking AND the global pass', () => {
    const report = buildRunReport(makeArgs());
    // per-region: 30 × 2 = 60 tokens, plus global 230 = 290
    expect(report.cost.ranking.totalTokens).toBe(290);
    expect(report.cost.ranking.costUsd).toBeCloseTo(0.0002 * 2 + 0.005);
  });

  it('treats a null global-ranking usage as zero', () => {
    const report = buildRunReport(makeArgs({ globalRankingUsage: null }));
    expect(report.cost.ranking.totalTokens).toBe(60); // only the two per-region passes
  });

  it('computes total as fetch + ranking', () => {
    const report = buildRunReport(makeArgs());
    expect(report.cost.total.totalTokens).toBe(590);
    expect(report.cost.total.costUsd).toBeCloseTo(0.0074);
  });

  it('reports status ok when there are no region errors', () => {
    expect(buildRunReport(makeArgs()).status).toBe('ok');
  });

  it('reports status partial when some regions failed', () => {
    const report = buildRunReport(
      makeArgs({ errors: [{ region: 'France', reason: new Error('boom') }] }),
    );
    expect(report.status).toBe('partial');
    expect(report.regions.failed).toEqual(['France']);
  });

  it('partitions regions into requested / succeeded', () => {
    const report = buildRunReport(makeArgs());
    expect(report.regions.requested).toEqual(['Hungary', 'United States']);
    expect(report.regions.succeeded).toEqual(['Hungary', 'United States']);
  });

  it('counts headlines requested and fetched', () => {
    const report = buildRunReport(makeArgs());
    expect(report.headlines.requested).toBe(regions.length * defaultConfig.api.fetch.count);
    expect(report.headlines.fetched).toBe(3); // 1 + 2
  });

  it('passes through the notify outcome', () => {
    const report = buildRunReport(makeArgs());
    expect(report.notify).toEqual({ devicesTargeted: 10, sent: 8, failed: 2 });
  });

  it('includes only digests that carry quality signals', () => {
    const quality = { region: 'Hungary' } as DigestQuality;
    const report = buildRunReport(
      makeArgs({
        digests: [makeDigest({ quality }), makeDigest({ region: 'United States' })],
      }),
    );
    expect(report.quality).toHaveLength(1);
  });

  it('stamps schema version and an ISO runAt', () => {
    const report = buildRunReport(makeArgs());
    expect(report.schema).toBe('pulse.run.v1');
    expect(report.runAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(report.durationMs).toBeGreaterThanOrEqual(0);
  });
});

// ── formatRunReportSummary ────────────────────────────────────────────────────

describe('formatRunReportSummary', () => {
  it('renders the key figures in one line', () => {
    const summary = formatRunReportSummary(buildRunReport(makeArgs()));
    expect(summary).toMatch(/^Run \[ok\] — 2\/2 regions, 3 headlines/);
    expect(summary).toContain('fetch $0.0020 (300 tok)');
    expect(summary).toContain('ranking $0.0054 (290 tok)');
    expect(summary).toContain('total $0.0074');
    expect(summary).toContain('notify 8/10');
  });

  it('abbreviates large token counts with k', () => {
    const big: DigestUsage = { ...fetchUsage, totalTokens: 45231 };
    const report = buildRunReport(makeArgs({ digests: [makeDigest({ usage: big })] }));
    expect(formatRunReportSummary(report)).toContain('(45.2k tok)');
  });
});

// ── persistRunReport ──────────────────────────────────────────────────────────

describe('persistRunReport', () => {
  beforeEach(() => mockInsert.mockReset());

  it('inserts a row with promoted scalar columns plus the full report', async () => {
    mockInsert.mockResolvedValueOnce({ error: null });
    const report = buildRunReport(makeArgs());

    await persistRunReport(report);

    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        run_at: report.runAt,
        status: 'ok',
        total_cost_usd: report.cost.total.costUsd,
        total_tokens: report.cost.total.totalTokens,
        regions_succeeded: 2,
        regions_failed: 0,
        duration_ms: report.durationMs,
        report,
      }),
    );
  });

  it('swallows a Supabase insert error (never throws)', async () => {
    mockInsert.mockResolvedValueOnce({ error: { message: 'permission denied' } });
    await expect(persistRunReport(buildRunReport(makeArgs()))).resolves.toBeUndefined();
  });

  it('swallows a thrown client error (never throws)', async () => {
    mockInsert.mockRejectedValueOnce(new Error('network down'));
    await expect(persistRunReport(buildRunReport(makeArgs()))).resolves.toBeUndefined();
  });
});
