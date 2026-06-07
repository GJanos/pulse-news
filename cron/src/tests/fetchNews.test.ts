import { loadPulseConfig } from '../config';
import { PerplexitySource } from '../fetchNews';
import type { DigestRequest } from '../types';

jest.mock('../lib/perplexityClient');
jest.mock('../logging');
// Stub the og:image network layer — fetchDigest calls it on the ranked set, and
// unit tests must not make real HTTP requests to the fixture URLs.
jest.mock('../lib/ogImage', () => ({
  fetchOgImages: jest.fn((headlines: Array<{ url: string }>) =>
    Promise.resolve(headlines.map(() => ({ imageUrl: null, source: 'none' as const }))),
  ),
}));

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
