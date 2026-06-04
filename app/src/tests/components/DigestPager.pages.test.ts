import { maxDayIndexFor, resolveSwipe } from '../../components/DigestPager';

/** Page slots rendered by the pager = oldest day-index + 1 (today + N prior days). */
const slotCount = (historyDays: number) => maxDayIndexFor(historyDays) + 1;

// Slice 1, item 4: historyDays: N means N days back from today → today + N pages.
// So historyDays 7 ⇒ 8 pages (maxDayIndex 7).

describe('maxDayIndexFor', () => {
  it('equals historyDays (N days back from today)', () => {
    expect(maxDayIndexFor(7)).toBe(7);
    expect(maxDayIndexFor(1)).toBe(1);
  });

  it('historyDays 0 → only today (maxDayIndex 0)', () => {
    expect(maxDayIndexFor(0)).toBe(0);
  });

  it('clamps negatives to 0', () => {
    expect(maxDayIndexFor(-3)).toBe(0);
  });
});

describe('page slot count (maxDayIndex + 1)', () => {
  it('historyDays 7 → 8 pages (today + 7)', () => {
    expect(slotCount(7)).toBe(8);
  });

  it('historyDays 0 → 1 page (today only)', () => {
    expect(slotCount(0)).toBe(1);
  });

  it('historyDays 1 → 2 pages', () => {
    expect(slotCount(1)).toBe(2);
  });

  it('clamps negatives → 1 page', () => {
    expect(slotCount(-5)).toBe(1);
  });
});

describe('resolveSwipe', () => {
  const THRESH = 80;
  const VT = 600;
  const base = { threshold: THRESH, velocityTrigger: VT, maxDayIndex: 7 };

  it('left swipe at dayIndex 0 → open-settings', () => {
    expect(resolveSwipe({ dayIndex: 0, dx: -100, vx: 0, ...base })).toBe('open-settings');
  });

  it('fast left velocity at dayIndex 0 → open-settings', () => {
    expect(resolveSwipe({ dayIndex: 0, dx: 0, vx: -700, ...base })).toBe('open-settings');
  });

  it('left swipe at dayIndex > 0 → newer', () => {
    expect(resolveSwipe({ dayIndex: 3, dx: -100, vx: 0, ...base })).toBe('newer');
  });

  it('right swipe at dayIndex < maxDayIndex → older', () => {
    expect(resolveSwipe({ dayIndex: 3, dx: 100, vx: 0, ...base })).toBe('older');
  });

  it('fast right velocity → older', () => {
    expect(resolveSwipe({ dayIndex: 2, dx: 0, vx: 700, ...base })).toBe('older');
  });

  it('right swipe at maxDayIndex → none (clamped)', () => {
    expect(resolveSwipe({ dayIndex: 7, dx: 100, vx: 0, ...base })).toBe('none');
  });

  it('sub-threshold right → none', () => {
    expect(resolveSwipe({ dayIndex: 3, dx: 40, vx: 0, ...base })).toBe('none');
  });

  it('sub-threshold left → none', () => {
    expect(resolveSwipe({ dayIndex: 3, dx: -40, vx: 0, ...base })).toBe('none');
  });
});
