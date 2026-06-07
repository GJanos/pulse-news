import { parseOgImage, fetchOgImage, fetchOgImages, MIN_IMAGE_WIDTH } from '../lib/ogImage';

const PAGE = 'https://news.example.com/world/article-123';

describe('parseOgImage', () => {
  it('reads og:image and reports source "og"', () => {
    const html = `<html><head>
      <meta property="og:image" content="https://cdn.example.com/hero.jpg">
    </head></html>`;
    expect(parseOgImage(html, PAGE)).toEqual({
      imageUrl: 'https://cdn.example.com/hero.jpg',
      source: 'og',
      width: undefined,
      height: undefined,
    });
  });

  it('falls back to twitter:image when og:image is absent', () => {
    const html = `<html><head>
      <meta name="twitter:image" content="https://cdn.example.com/tw.jpg">
    </head></html>`;
    const r = parseOgImage(html, PAGE);
    expect(r.imageUrl).toBe('https://cdn.example.com/tw.jpg');
    expect(r.source).toBe('twitter');
  });

  it('prefers og:image over twitter:image', () => {
    const html = `<html><head>
      <meta property="og:image" content="https://cdn.example.com/og.jpg">
      <meta name="twitter:image" content="https://cdn.example.com/tw.jpg">
    </head></html>`;
    expect(parseOgImage(html, PAGE).source).toBe('og');
    expect(parseOgImage(html, PAGE).imageUrl).toBe('https://cdn.example.com/og.jpg');
  });

  it('uses og:image:secure_url when og:image is missing', () => {
    const html = `<html><head>
      <meta property="og:image:secure_url" content="https://cdn.example.com/secure.jpg">
    </head></html>`;
    expect(parseOgImage(html, PAGE).imageUrl).toBe('https://cdn.example.com/secure.jpg');
    expect(parseOgImage(html, PAGE).source).toBe('og');
  });

  it('resolves a relative image URL against pageUrl', () => {
    const html = `<html><head>
      <meta property="og:image" content="/media/hero.jpg">
    </head></html>`;
    expect(parseOgImage(html, PAGE).imageUrl).toBe('https://news.example.com/media/hero.jpg');
  });

  it('keeps an image whose declared dimensions meet the minimum', () => {
    const html = `<html><head>
      <meta property="og:image" content="https://cdn.example.com/hero.jpg">
      <meta property="og:image:width" content="1200">
      <meta property="og:image:height" content="630">
    </head></html>`;
    expect(parseOgImage(html, PAGE)).toEqual({
      imageUrl: 'https://cdn.example.com/hero.jpg',
      source: 'og',
      width: 1200,
      height: 630,
    });
  });

  it('drops an image whose declared dimensions are below the minimum', () => {
    const small = MIN_IMAGE_WIDTH - 1;
    const html = `<html><head>
      <meta property="og:image" content="https://cdn.example.com/thumb.jpg">
      <meta property="og:image:width" content="${small}">
      <meta property="og:image:height" content="100">
    </head></html>`;
    expect(parseOgImage(html, PAGE)).toEqual({ imageUrl: null, source: 'none' });
  });

  it('keeps an image when dimensions are not declared', () => {
    const html = `<html><head>
      <meta property="og:image" content="https://cdn.example.com/hero.jpg">
    </head></html>`;
    expect(parseOgImage(html, PAGE).imageUrl).toBe('https://cdn.example.com/hero.jpg');
  });

  it('returns none when no image tags are present', () => {
    const html = `<html><head><title>No image here</title></head></html>`;
    expect(parseOgImage(html, PAGE)).toEqual({ imageUrl: null, source: 'none' });
  });

  it('returns none for malformed / empty HTML', () => {
    expect(parseOgImage('', PAGE)).toEqual({ imageUrl: null, source: 'none' });
    expect(parseOgImage('<<not really html', PAGE)).toEqual({ imageUrl: null, source: 'none' });
  });
});

// ---------------------------------------------------------------------------
// fetchOgImage — network wrapper (global.fetch mocked)
// ---------------------------------------------------------------------------

const NONE = { imageUrl: null, source: 'none' as const };

/** Builds a minimal Response-like object matching what fetchOgImage reads. */
function fakeResponse(opts: {
  ok?: boolean;
  contentType?: string | null;
  body?: string;
}): Response {
  const { ok = true, contentType = 'text/html; charset=utf-8', body = '' } = opts;
  return {
    ok,
    headers: { get: (k: string) => (k.toLowerCase() === 'content-type' ? contentType : null) },
    text: async () => body,
  } as unknown as Response;
}

const OG_HTML = `<html><head>
  <meta property="og:image" content="https://cdn.example.com/hero.jpg">
</head></html>`;

describe('fetchOgImage', () => {
  const realFetch = global.fetch;

  afterEach(() => {
    global.fetch = realFetch;
    jest.useRealTimers();
  });

  it('parses og:image from a 200 HTML response', async () => {
    global.fetch = jest.fn().mockResolvedValue(fakeResponse({ body: OG_HTML }));
    const r = await fetchOgImage(PAGE);
    expect(r.imageUrl).toBe('https://cdn.example.com/hero.jpg');
    expect(r.source).toBe('og');
  });

  it('sends a desktop User-Agent and follows redirects', async () => {
    const spy = jest.fn().mockResolvedValue(fakeResponse({ body: OG_HTML }));
    global.fetch = spy;
    await fetchOgImage(PAGE);
    const init = spy.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>)['User-Agent']).toMatch(/Mozilla\/5\.0/);
    expect(init.redirect).toBe('follow');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('honours a custom userAgent option', async () => {
    const spy = jest.fn().mockResolvedValue(fakeResponse({ body: OG_HTML }));
    global.fetch = spy;
    await fetchOgImage(PAGE, { userAgent: 'PulseBot/1.0' });
    const init = spy.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>)['User-Agent']).toBe('PulseBot/1.0');
  });

  it('returns none on a non-OK status (e.g. 403 bot-block)', async () => {
    global.fetch = jest.fn().mockResolvedValue(fakeResponse({ ok: false, body: OG_HTML }));
    expect(await fetchOgImage(PAGE)).toEqual(NONE);
  });

  it('returns none when the response is not HTML', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(fakeResponse({ contentType: 'application/json', body: '{}' }));
    expect(await fetchOgImage(PAGE)).toEqual(NONE);
  });

  it('returns none when content-type header is absent', async () => {
    global.fetch = jest.fn().mockResolvedValue(fakeResponse({ contentType: null, body: OG_HTML }));
    expect(await fetchOgImage(PAGE)).toEqual(NONE);
  });

  it('returns none when fetch rejects (network error)', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    expect(await fetchOgImage(PAGE)).toEqual(NONE);
  });

  it('aborts and returns none once the timeout elapses', async () => {
    jest.useFakeTimers();
    // A fetch that never settles on its own, but rejects when its signal aborts.
    global.fetch = jest.fn(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          const signal = (init as RequestInit).signal!;
          signal.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    ) as unknown as typeof fetch;

    const p = fetchOgImage(PAGE, { timeoutMs: 1000 });
    jest.advanceTimersByTime(1000);
    await expect(p).resolves.toEqual(NONE);
  });
});

// ---------------------------------------------------------------------------
// fetchOgImages — parallel batch
// ---------------------------------------------------------------------------

describe('fetchOgImages', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('resolves results 1:1 with input order across mixed success/failure', async () => {
    const okHtml = `<html><head>
      <meta property="og:image" content="https://cdn.example.com/a.jpg"></head></html>`;
    global.fetch = jest.fn((url: string) => {
      if (url.includes('/ok')) return Promise.resolve(fakeResponse({ body: okHtml }));
      if (url.includes('/blocked')) return Promise.resolve(fakeResponse({ ok: false }));
      return Promise.reject(new Error('network error'));
    }) as unknown as typeof fetch;

    const results = await fetchOgImages([
      { url: 'https://news.example.com/ok' },
      { url: 'https://news.example.com/blocked' },
      { url: 'https://news.example.com/dead' },
    ]);

    expect(results).toHaveLength(3);
    expect(results[0]).toEqual({
      imageUrl: 'https://cdn.example.com/a.jpg',
      source: 'og',
      width: undefined,
      height: undefined,
    });
    expect(results[1]).toEqual(NONE);
    expect(results[2]).toEqual(NONE);
  });

  it('returns an empty array for no headlines without calling fetch', async () => {
    const spy = jest.fn();
    global.fetch = spy as unknown as typeof fetch;
    expect(await fetchOgImages([])).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });
});
