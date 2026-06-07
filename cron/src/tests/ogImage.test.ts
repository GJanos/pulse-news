import { parseOgImage, MIN_IMAGE_WIDTH } from '../lib/ogImage';

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
