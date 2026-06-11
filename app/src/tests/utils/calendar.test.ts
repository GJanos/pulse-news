import { dayIndexForDate, monthGrid, addMonths, sameMonth, monthLabel } from '../../utils/calendar';

const TODAY = '2026-06-11';

describe('dayIndexForDate', () => {
  it('is 0 for today and counts backwards in days', () => {
    expect(dayIndexForDate('2026-06-11', TODAY)).toBe(0);
    expect(dayIndexForDate('2026-06-10', TODAY)).toBe(1);
    expect(dayIndexForDate('2026-06-04', TODAY)).toBe(7);
  });

  it('is negative for future dates', () => {
    expect(dayIndexForDate('2026-06-12', TODAY)).toBe(-1);
  });

  it('crosses month boundaries', () => {
    expect(dayIndexForDate('2026-05-31', TODAY)).toBe(11);
  });
});

describe('monthGrid', () => {
  it('lays out June 2026 Monday-first', () => {
    const weeks = monthGrid(TODAY, TODAY, 7);
    // 2026-06-01 is a Monday → no leading pad.
    expect(weeks[0]![0]!.iso).toBe('2026-06-01');
    expect(weeks[0]![0]!.day).toBe(1);
    // 30 days → last week padded to 7.
    const lastWeek = weeks[weeks.length - 1]!;
    expect(lastWeek).toHaveLength(7);
    expect(lastWeek.filter(Boolean).map((c) => c!.day)).toContain(30);
  });

  it('enables only dates within the history window', () => {
    const weeks = monthGrid(TODAY, TODAY, 7);
    const cells = weeks.flat().filter((c): c is NonNullable<typeof c> => c !== null);
    const byIso = new Map(cells.map((c) => [c.iso, c]));
    expect(byIso.get('2026-06-11')!.dayIndex).toBe(0); // today
    expect(byIso.get('2026-06-04')!.dayIndex).toBe(7); // oldest reachable
    expect(byIso.get('2026-06-03')!.dayIndex).toBeNull(); // too old
    expect(byIso.get('2026-06-12')!.dayIndex).toBeNull(); // future
  });

  it('pads months that do not start on Monday', () => {
    // May 2026 starts on a Friday → 4 leading nulls.
    const weeks = monthGrid('2026-05-15', TODAY, 30);
    expect(weeks[0]!.slice(0, 4)).toEqual([null, null, null, null]);
    expect(weeks[0]![4]!.iso).toBe('2026-05-01');
  });
});

describe('addMonths / sameMonth / monthLabel', () => {
  it('addMonths steps to the first of the offset month', () => {
    expect(addMonths('2026-06-11', -1)).toBe('2026-05-01');
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-01');
    expect(addMonths('2025-12-31', 1)).toBe('2026-01-01');
  });

  it('sameMonth compares year-month only', () => {
    expect(sameMonth('2026-06-01', '2026-06-30')).toBe(true);
    expect(sameMonth('2026-06-01', '2026-05-31')).toBe(false);
  });

  it('monthLabel renders "Month YYYY"', () => {
    expect(monthLabel('2026-06-11')).toBe('June 2026');
  });
});
