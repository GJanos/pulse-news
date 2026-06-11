/**
 * Pure helpers for the history calendar picker. All dates are UTC ISO
 * YYYY-MM-DD strings, matching the digest date convention in `data.ts`.
 */

export interface CalendarCell {
  iso: string;
  /** Day of month, 1-based. */
  day: number;
  /** Pager day-index (0 = today) when the date is browsable, else null. */
  dayIndex: number | null;
}

/** Weeks are Monday-first. A null cell pads days outside the month. */
export type CalendarWeek = Array<CalendarCell | null>;

function parseISO(iso: string): Date {
  return new Date(iso + 'T00:00:00Z');
}

/** Whole days from `iso` to `todayISO`; positive when iso is in the past. */
export function dayIndexForDate(iso: string, todayISO: string): number {
  const ms = parseISO(todayISO).getTime() - parseISO(iso).getTime();
  return Math.round(ms / 86_400_000);
}

/**
 * The month grid for the month containing `monthISO` (any date in that month).
 * Cells outside the browsable window [today − maxDayIndex, today] get
 * `dayIndex: null` so the UI can disable them.
 */
export function monthGrid(monthISO: string, todayISO: string, maxDayIndex: number): CalendarWeek[] {
  const first = parseISO(monthISO.slice(0, 8) + '01');
  const year = first.getUTCFullYear();
  const month = first.getUTCMonth();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  // getUTCDay: 0 = Sunday; shift so Monday = 0.
  const leadingPad = (first.getUTCDay() + 6) % 7;

  const weeks: CalendarWeek[] = [];
  let week: CalendarWeek = new Array<CalendarCell | null>(leadingPad).fill(null);
  for (let day = 1; day <= daysInMonth; day++) {
    const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const idx = dayIndexForDate(iso, todayISO);
    week.push({ iso, day, dayIndex: idx >= 0 && idx <= maxDayIndex ? idx : null });
    if (week.length === 7) {
      weeks.push(week);
      week = [];
    }
  }
  if (week.length > 0) {
    while (week.length < 7) week.push(null);
    weeks.push(week);
  }
  return weeks;
}

/** First day of the month `offset` months before the month containing `iso`. */
export function addMonths(iso: string, offset: number): string {
  const d = parseISO(iso.slice(0, 8) + '01');
  d.setUTCMonth(d.getUTCMonth() + offset);
  return d.toISOString().slice(0, 10);
}

/** True when `a` and `b` fall in the same calendar month. */
export function sameMonth(a: string, b: string): boolean {
  return a.slice(0, 7) === b.slice(0, 7);
}

export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/** "June 2026" for any ISO date in the month. */
export function monthLabel(iso: string): string {
  const d = parseISO(iso.slice(0, 8) + '01');
  return `${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
