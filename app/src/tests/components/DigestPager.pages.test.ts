import { maxDayIndexFor } from '../../components/DigestPager';

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
