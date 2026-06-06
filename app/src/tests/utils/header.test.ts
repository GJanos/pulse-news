import { headerOpacityForScrollX, HEADER_FADE_EPSILON } from '../../utils/header';

// Pager layout: [oldest day] … [today] [settings].
// settingsPage is the page index occupied by settings; width is page width.
const WIDTH = 375;
const SETTINGS_PAGE = 8; // e.g. maxDayIndex 7 → settings at page 8
const SETTINGS_X = SETTINGS_PAGE * WIDTH; // 3000
const FADE_START = SETTINGS_X - WIDTH; // 2625

describe('headerOpacityForScrollX', () => {
  it('returns 1 across day pages (offset before the final segment)', () => {
    expect(headerOpacityForScrollX(0, SETTINGS_PAGE, WIDTH)).toBe(1);
    expect(headerOpacityForScrollX(WIDTH, SETTINGS_PAGE, WIDTH)).toBe(1);
    expect(headerOpacityForScrollX(FADE_START, SETTINGS_PAGE, WIDTH)).toBe(1);
  });

  it('ramps 1 → 0 linearly across the final page-width before settings', () => {
    expect(headerOpacityForScrollX(FADE_START + WIDTH / 2, SETTINGS_PAGE, WIDTH)).toBeCloseTo(
      0.5,
      5,
    );
    expect(headerOpacityForScrollX(SETTINGS_X, SETTINGS_PAGE, WIDTH)).toBe(0);
  });

  it('clamps to [0, 1] beyond either end', () => {
    expect(headerOpacityForScrollX(-200, SETTINGS_PAGE, WIDTH)).toBe(1);
    expect(headerOpacityForScrollX(SETTINGS_X + WIDTH, SETTINGS_PAGE, WIDTH)).toBe(0);
  });

  it('returns 1 for a non-positive width (guard)', () => {
    expect(headerOpacityForScrollX(100, SETTINGS_PAGE, 0)).toBe(1);
  });

  it('crosses the pointerEvents epsilon just before the settings page', () => {
    // opacity 0.01 sits below the epsilon, so the bar becomes non-interactive
    const x = SETTINGS_X - 0.01 * WIDTH;
    expect(headerOpacityForScrollX(x, SETTINGS_PAGE, WIDTH)).toBeLessThan(HEADER_FADE_EPSILON);
    // opacity 0.5 stays above it
    expect(headerOpacityForScrollX(FADE_START + WIDTH / 2, SETTINGS_PAGE, WIDTH)).toBeGreaterThan(
      HEADER_FADE_EPSILON,
    );
  });
});
