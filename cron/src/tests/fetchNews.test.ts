import { loadPulseConfig } from '../config';
import { PerplexitySource, domainsFromSources } from '../fetchNews';
import type { DigestRequest } from '../types';

jest.mock('../lib/perplexityClient');
jest.mock('../logging');

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { callPerplexity } = require('../lib/perplexityClient');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getLogger } = require('../logging');

const mockLogger = { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), child: jest.fn() };
mockLogger.child.mockReturnValue(mockLogger);
getLogger.mockReturnValue(mockLogger);

// Override fetch settings to prevent retry delays and retry loops in tests.
const baseConfig = loadPulseConfig();
const testConfig = {
  ...baseConfig,
  api: {
    ...baseConfig.api,
    fetch: { ...baseConfig.api.fetch, retryDelay: 0, minResults: 1, maxAttempts: 1 },
  },
};

function makeCompletion(headlines: object[], searchResults: object[] = []) {
  return {
    choices: [{ message: { content: JSON.stringify({ headlines }) } }],
    usage: {
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
      cost: { total_cost: 0.001 },
    },
    search_results: searchResults,
    citations: [],
  };
}

const request: DigestRequest = { region: 'United Kingdom', country: 'GB', sources: [], count: 2 };

beforeEach(() => {
  jest.clearAllMocks();
  mockLogger.child.mockReturnValue(mockLogger);
  getLogger.mockReturnValue(mockLogger);
});

// ---------------------------------------------------------------------------
// domainsFromSources
// ---------------------------------------------------------------------------

describe('domainsFromSources', () => {
  it('extracts bare domains from parenthesised source labels', () => {
    expect(domainsFromSources(['Telex (telex.hu)', 'HVG (hvg.hu)'])).toEqual([
      'telex.hu',
      'hvg.hu',
    ]);
  });

  it('strips paths and deduplicates', () => {
    expect(
      domainsFromSources([
        'BBC News (bbc.co.uk/news)',
        'The Guardian (theguardian.com)',
        'The Guardian US (theguardian.com)',
      ]),
    ).toEqual(['bbc.co.uk', 'theguardian.com']);
  });

  it('skips entries without a parseable domain', () => {
    expect(domainsFromSources(['Some Outlet', ''])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// search_domain_filter rounds
// ---------------------------------------------------------------------------

describe('search_domain_filter', () => {
  const sources = ['Telex (telex.hu)', 'HVG (hvg.hu)'];
  const headline = {
    title: 'Hungary Budget Plan Announced',
    summary: 'The government announced the budget.',
    detail: 'Tax changes take effect next April.',
    url: 'https://telex.hu/gazdasag/budget-2026/',
    category: 'Economy',
    source_name: 'Telex',
  };
  const searchResult = {
    title: 'Hungary Budget Plan Announced',
    url: 'https://telex.hu/gazdasag/budget-2026/',
    snippet: 'hungary budget plan',
  };

  it('passes curated domains on rounds below domainFilterRounds', async () => {
    callPerplexity.mockResolvedValue(makeCompletion([headline], [searchResult]));
    const config = {
      ...testConfig,
      api: {
        ...testConfig.api,
        fetch: { ...testConfig.api.fetch, domainFilterRounds: 2 },
      },
    };
    const source = new PerplexitySource(config, 'test-key');
    await source.fetchDigest({ region: 'Hungary', country: 'HU', sources, count: 1 });

    const payload = callPerplexity.mock.calls[0]![2] as Record<string, unknown>;
    expect(payload.search_domain_filter).toEqual(['telex.hu', 'hvg.hu']);
  });

  it('drops the filter once the round reaches domainFilterRounds', async () => {
    callPerplexity.mockResolvedValue(makeCompletion([], []));
    const config = {
      ...testConfig,
      api: {
        ...testConfig.api,
        fetch: { ...testConfig.api.fetch, domainFilterRounds: 1, maxAttempts: 2, minResults: 1 },
      },
    };
    const source = new PerplexitySource(config, 'test-key');
    await source.fetchDigest({ region: 'Hungary', country: 'HU', sources, count: 1 });

    expect(callPerplexity).toHaveBeenCalledTimes(2);
    const first = callPerplexity.mock.calls[0]![2] as Record<string, unknown>;
    const second = callPerplexity.mock.calls[1]![2] as Record<string, unknown>;
    expect(first.search_domain_filter).toEqual(['telex.hu', 'hvg.hu']);
    expect(second.search_domain_filter).toBeUndefined();
  });

  it('omits the filter entirely when domainFilterRounds is 0', async () => {
    callPerplexity.mockResolvedValue(makeCompletion([headline], [searchResult]));
    const config = {
      ...testConfig,
      api: {
        ...testConfig.api,
        fetch: { ...testConfig.api.fetch, domainFilterRounds: 0 },
      },
    };
    const source = new PerplexitySource(config, 'test-key');
    await source.fetchDigest({ region: 'Hungary', country: 'HU', sources, count: 1 });

    const payload = callPerplexity.mock.calls[0]![2] as Record<string, unknown>;
    expect(payload.search_domain_filter).toBeUndefined();
  });

  it('omits the filter when the region has no parseable source domains', async () => {
    callPerplexity.mockResolvedValue(makeCompletion([headline], [searchResult]));
    const source = new PerplexitySource(testConfig, 'test-key');
    await source.fetchDigest({ region: 'Hungary', country: 'HU', sources: [], count: 1 });

    const payload = callPerplexity.mock.calls[0]![2] as Record<string, unknown>;
    expect(payload.search_domain_filter).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Constructor
// ---------------------------------------------------------------------------

describe('PerplexitySource constructor', () => {
  it('throws when PERPLEXITY_API_KEY is not provided', () => {
    expect(() => new PerplexitySource(testConfig, undefined)).toThrow('PERPLEXITY_API_KEY');
  });

  it('constructs without error when key is provided', () => {
    expect(() => new PerplexitySource(testConfig, 'test-key')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// fetchDigest — return shape
// ---------------------------------------------------------------------------

describe('fetchDigest return shape', () => {
  it('returns a RegionDigest with region, headlines, usage, and quality', async () => {
    callPerplexity.mockResolvedValue(
      makeCompletion(
        [
          {
            title: 'UK Budget Plan Announced',
            summary: 'The chancellor announced the budget.',
            detail: 'Tax changes take effect next April.',
            url: 'https://reuters.com/world/uk/budget-2024/',
            category: 'Economy',
            source_name: 'Reuters',
          },
        ],
        [
          {
            title: 'UK Budget Plan Announced',
            url: 'https://reuters.com/world/uk/budget-2024/',
            snippet: 'UK budget plan chancellor',
          },
        ],
      ),
    );

    const source = new PerplexitySource(testConfig, 'test-key');
    const result = await source.fetchDigest({ ...request, count: 1 });

    expect(result.region).toBe('United Kingdom');
    expect(result.headlines).toHaveLength(1);
    expect(result.headlines[0]!.title).toBe('UK Budget Plan Announced');
    expect(result.usage!.totalTokens).toBe(150);
    expect(result.usage!.costUsd).toBeCloseTo(0.001);
    expect(result.quality!.status).toBe('ok');
    expect(result.attempts).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// fetchDigest — rankHeadlines stub (Phase 4 TODO)
// ---------------------------------------------------------------------------

describe('fetchDigest rankHeadlines stub', () => {
  it('slices to count without reordering (pass-through until Phase 4)', async () => {
    callPerplexity.mockResolvedValue(
      makeCompletion(
        [
          {
            title: 'UK Chancellor Announces Budget Cuts',
            summary: 'New budget measures.',
            detail: 'Spending cuts across departments.',
            url: 'https://reuters.com/world/uk/budget-cuts/',
            category: 'Economy',
            source_name: 'Reuters',
          },
          {
            title: 'Scottish Parliament Votes Independence Referendum',
            summary: 'Independence vote scheduled.',
            detail: 'Referendum planned for next year.',
            url: 'https://bbc.co.uk/news/scotland-referendum',
            category: 'Politics',
            source_name: 'BBC',
          },
          {
            title: 'NHS Announces Hospital Expansion Programme',
            summary: 'Hospitals will expand.',
            detail: 'Funding secured for new wings.',
            url: 'https://theguardian.com/uk/nhs-expansion',
            category: 'Health',
            source_name: 'Guardian',
          },
        ],
        [
          {
            title: 'UK Chancellor Announces Budget Cuts',
            url: 'https://reuters.com/world/uk/budget-cuts/',
            snippet: 'chancellor budget cuts',
          },
          {
            title: 'Scottish Parliament Votes Independence Referendum',
            url: 'https://bbc.co.uk/news/scotland-referendum',
            snippet: 'scotland referendum parliament',
          },
          {
            title: 'NHS Announces Hospital Expansion Programme',
            url: 'https://theguardian.com/uk/nhs-expansion',
            snippet: 'nhs hospital expansion',
          },
        ],
      ),
    );

    const source = new PerplexitySource(testConfig, 'test-key');
    const result = await source.fetchDigest({ ...request, count: 2 });

    expect(result.headlines).toHaveLength(2);
    expect(result.headlines[0]!.title).toBe('UK Chancellor Announces Budget Cuts');
    expect(result.headlines[1]!.title).toBe('Scottish Parliament Votes Independence Referendum');
  });
});

// ---------------------------------------------------------------------------
// fetchDigest — topic deduplication
// ---------------------------------------------------------------------------

describe('fetchDigest topic deduplication', () => {
  it('drops a second headline that is a near-duplicate of the first', async () => {
    callPerplexity.mockResolvedValue(
      makeCompletion(
        [
          {
            title: 'Bank of England raises interest rates sharply',
            summary: 'The Bank raised rates.',
            detail: 'This is a big move.',
            url: 'https://reuters.com/world/uk/boe-rates/',
            category: 'Economy',
            source_name: 'Reuters',
          },
          {
            title: 'Bank of England raises rates again today',
            summary: 'Rates raised again.',
            detail: 'Another rate rise.',
            url: 'https://bbc.co.uk/news/boe-rates-again',
            category: 'Economy',
            source_name: 'BBC',
          },
        ],
        [
          {
            title: 'Bank of England raises interest rates sharply',
            url: 'https://reuters.com/world/uk/boe-rates/',
            snippet: 'bank england raises interest rates',
          },
          {
            title: 'Bank of England raises rates again today',
            url: 'https://bbc.co.uk/news/boe-rates-again',
            snippet: 'bank england raises rates again',
          },
        ],
      ),
    );

    const source = new PerplexitySource(testConfig, 'test-key');
    const result = await source.fetchDigest({ ...request, count: 5 });

    expect(result.headlines).toHaveLength(1);
    expect(result.quality!.topicDropCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// fetchDigest — quality metrics
// ---------------------------------------------------------------------------

describe('fetchDigest quality metrics', () => {
  it('sets status partial when fewer than count headlines pass filters', async () => {
    // One real headline + one placeholder that gets filtered → 1 of 2 → partial
    callPerplexity.mockResolvedValue(
      makeCompletion(
        [
          {
            title: 'UK Budget Plan Announced Real',
            summary: 'Real budget story.',
            detail: 'Budget details.',
            url: 'https://reuters.com/world/uk/real-budget/',
            category: 'Economy',
            source_name: 'Reuters',
          },
          {
            title: 'No news available',
            summary: 'Nothing to report.',
            detail: 'No details.',
            url: 'https://reuters.com/world/uk/placeholder/',
            category: 'None',
            source_name: 'None',
          },
        ],
        [
          {
            title: 'UK Budget Plan Announced Real',
            url: 'https://reuters.com/world/uk/real-budget/',
            snippet: 'budget plan real',
          },
        ],
      ),
    );

    const source = new PerplexitySource(testConfig, 'test-key');
    const result = await source.fetchDigest({ ...request, count: 2 });

    expect(result.quality!.status).toBe('partial');
    expect(result.headlines).toHaveLength(1);
  });

  it('populates usage from Perplexity response', async () => {
    callPerplexity.mockResolvedValue(
      makeCompletion(
        [
          {
            title: 'UK Parliament Votes New Bill',
            summary: 'Parliament passed a bill.',
            detail: 'The bill covers tax reform.',
            url: 'https://reuters.com/world/uk/parliament-bill/',
            category: 'Politics',
            source_name: 'Reuters',
          },
        ],
        [
          {
            title: 'UK Parliament Votes New Bill',
            url: 'https://reuters.com/world/uk/parliament-bill/',
            snippet: 'parliament votes bill',
          },
        ],
      ),
    );

    const source = new PerplexitySource(testConfig, 'test-key');
    const result = await source.fetchDigest({ ...request, count: 1 });

    expect(result.usage!.promptTokens).toBe(100);
    expect(result.usage!.completionTokens).toBe(50);
    expect(result.usage!.totalTokens).toBe(150);
    expect(result.quality!.usage.costUsd).toBeCloseTo(0.001);
  });
});
