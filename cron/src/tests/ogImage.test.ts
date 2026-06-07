import {
  parseOgImage,
  deduplicateOgImages,
  MIN_IMAGE_WIDTH,
  MIN_ASPECT_RATIO,
} from '../lib/ogImage';
import type { OgImageResult } from '../lib/ogImage';

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

  it('drops a square image when both dimensions are declared', () => {
    const side = MIN_IMAGE_WIDTH;
    const html = `<html><head>
      <meta property="og:image" content="https://cdn.example.com/logo.jpg">
      <meta property="og:image:width" content="${side}">
      <meta property="og:image:height" content="${side}">
    </head></html>`;
    expect(parseOgImage(html, PAGE)).toEqual({ imageUrl: null, source: 'none' });
  });

  it('drops a portrait image when both dimensions are declared', () => {
    const html = `<html><head>
      <meta property="og:image" content="https://cdn.example.com/portrait.jpg">
      <meta property="og:image:width" content="630">
      <meta property="og:image:height" content="1200">
    </head></html>`;
    expect(parseOgImage(html, PAGE)).toEqual({ imageUrl: null, source: 'none' });
  });

  it(`keeps an image just above MIN_ASPECT_RATIO (${MIN_ASPECT_RATIO})`, () => {
    const html = `<html><head>
      <meta property="og:image" content="https://cdn.example.com/wide.jpg">
      <meta property="og:image:width" content="1200">
      <meta property="og:image:height" content="800">
    </head></html>`;
    expect(parseOgImage(html, PAGE).imageUrl).toBe('https://cdn.example.com/wide.jpg');
  });

  it('keeps an image with no declared dimensions despite square-looking URL', () => {
    const html = `<html><head>
      <meta property="og:image" content="https://cdn.example.com/square-logo.jpg">
    </head></html>`;
    expect(parseOgImage(html, PAGE).imageUrl).toBe('https://cdn.example.com/square-logo.jpg');
  });
});

describe('deduplicateOgImages', () => {
  const ok = (url: string): OgImageResult => ({
    imageUrl: url,
    source: 'og',
    width: 1200,
    height: 630,
  });
  const none: OgImageResult = { imageUrl: null, source: 'none' };

  it('returns a single-item array unchanged', () => {
    expect(deduplicateOgImages([ok('https://cdn.example.com/a.jpg')])).toEqual([
      ok('https://cdn.example.com/a.jpg'),
    ]);
  });

  it('preserves unique imageUrls across a batch', () => {
    const results = [ok('https://cdn.example.com/a.jpg'), ok('https://cdn.example.com/b.jpg')];
    expect(deduplicateOgImages(results)).toEqual(results);
  });

  it('nulls duplicate imageUrls when the same URL appears 2+ times', () => {
    const dup = 'https://npr.org/assets/img/logo.jpg';
    const results = [ok(dup), ok('https://cdn.example.com/b.jpg'), ok(dup)];
    const out = deduplicateOgImages(results);
    expect(out[0]).toEqual(none);
    expect(out[1]).toEqual(ok('https://cdn.example.com/b.jpg'));
    expect(out[2]).toEqual(none);
  });

  it('does not treat null imageUrls as duplicates of each other', () => {
    const results = [none, none, ok('https://cdn.example.com/a.jpg')];
    const out = deduplicateOgImages(results);
    expect(out[0]).toEqual(none);
    expect(out[1]).toEqual(none);
    expect(out[2]).toEqual(ok('https://cdn.example.com/a.jpg'));
  });

  it('nulls only the duplicated entries, leaving unique ones intact', () => {
    const dup = 'https://apnews.com/hub/logo.png';
    const results = [
      ok(dup),
      ok('https://cdn.bbc.co.uk/real-photo.jpg'),
      ok(dup),
      ok('https://cdn.guardian.com/other-photo.jpg'),
    ];
    const out = deduplicateOgImages(results);
    expect(out[0]).toEqual(none);
    expect(out[1]).toEqual(ok('https://cdn.bbc.co.uk/real-photo.jpg'));
    expect(out[2]).toEqual(none);
    expect(out[3]).toEqual(ok('https://cdn.guardian.com/other-photo.jpg'));
  });
});
