import {
  maxDayIndexFor,
  pageForDay,
  settingsPage,
  targetForPage,
} from '../../components/DigestPager';

/** Day page slots = oldest day-index + 1 (today + N prior days). */
const dayPageCount = (historyDays: number) => maxDayIndexFor(historyDays) + 1;

// Slice 1, item 4: historyDays: N means N days back from today → today + N pages.
// So historyDays 7 ⇒ 8 day pages (maxDayIndex 7), plus a trailing settings page.

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

describe('day page count (maxDayIndex + 1)', () => {
  it('historyDays 7 → 8 day pages (today + 7)', () => {
    expect(dayPageCount(7)).toBe(8);
  });

  it('historyDays 0 → 1 day page (today only)', () => {
    expect(dayPageCount(0)).toBe(1);
  });

  it('historyDays 1 → 2 day pages', () => {
    expect(dayPageCount(1)).toBe(2);
  });

  it('clamps negatives → 1 day page', () => {
    expect(dayPageCount(-5)).toBe(1);
  });
});

describe('pageForDay / settingsPage — strip is [oldest … today] [settings]', () => {
  const MAX = 7;

  it('today (dayIndex 0) is the last day page', () => {
    expect(pageForDay(0, MAX)).toBe(MAX);
  });

  it('the oldest day (maxDayIndex) is the first page', () => {
    expect(pageForDay(MAX, MAX)).toBe(0);
  });

  it('a mid day-index maps to its offset from the oldest', () => {
    expect(pageForDay(3, MAX)).toBe(4);
  });

  it('settings sits immediately after today', () => {
    expect(settingsPage(MAX)).toBe(MAX + 1);
    expect(settingsPage(MAX)).toBe(pageForDay(0, MAX) + 1);
  });
});

describe('targetForPage', () => {
  const MAX = 7;

  it('the settings page resolves to settings', () => {
    expect(targetForPage(settingsPage(MAX), MAX)).toEqual({ kind: 'settings' });
  });

  it('anything past the settings page still resolves to settings (overscroll)', () => {
    expect(targetForPage(MAX + 5, MAX)).toEqual({ kind: 'settings' });
  });

  it("today's page resolves to dayIndex 0", () => {
    expect(targetForPage(pageForDay(0, MAX), MAX)).toEqual({ kind: 'day', dayIndex: 0 });
  });

  it('the first page resolves to the oldest day', () => {
    expect(targetForPage(0, MAX)).toEqual({ kind: 'day', dayIndex: MAX });
  });

  it('a mid page resolves to its day-index', () => {
    expect(targetForPage(4, MAX)).toEqual({ kind: 'day', dayIndex: 3 });
  });

  it('clamps a negative page to the oldest day (overscroll left)', () => {
    expect(targetForPage(-2, MAX)).toEqual({ kind: 'day', dayIndex: MAX });
  });

  it('round-trips every day-index through pageForDay → targetForPage', () => {
    for (let d = 0; d <= MAX; d++) {
      expect(targetForPage(pageForDay(d, MAX), MAX)).toEqual({ kind: 'day', dayIndex: d });
    }
  });
});
