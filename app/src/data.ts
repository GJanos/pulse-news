import { REGIONS, type Region } from '@pulse/shared/regions';
export { REGIONS };

/** Returns selected regions in the user's persisted selection order. */
export function sortedSelectedRegions(selected: string[]): Region[] {
  const regionMap = new Map(REGIONS.map((r) => [r.region, r]));
  return selected.map((name) => regionMap.get(name)).filter((r): r is Region => r !== undefined);
}

/** Returns today's UTC date as YYYY-MM-DD. Called per-use so it stays correct past midnight. */
export function getTodayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Today's UTC date as YYYY-MM-DD. Evaluated once at module load; use getTodayISO() if you need it fresh past midnight. */
export const TODAY_ISO: string = getTodayISO();

/** Returns the UTC ISO date string that is `dayIndex` days before today. */
export function isoDateAtDayIndex(dayIndex: number): string {
  const d = new Date(getTodayISO() + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - dayIndex);
  return d.toISOString().slice(0, 10);
}

export interface FormattedDate {
  wd: string;
  mo: string;
  day: number;
  year: number;
}

export function formatLongDate(iso: string): FormattedDate {
  const d = new Date(iso + 'T08:00:00Z');
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()]!;
  const mo = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][
    d.getUTCMonth()
  ]!;
  return { wd, mo, day: d.getUTCDate(), year: d.getUTCFullYear() };
}
