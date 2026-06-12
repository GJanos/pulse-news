/** Snap a UTC total-minutes value to the nearest 30-min boundary, returning "HH:MM". */
export function snapToHalfHour(utcMinutes: number): string {
  const snapped = Math.round(utcMinutes / 30) * 30;
  const h = Math.floor(snapped / 60) % 24;
  const m = snapped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Convert a local "HH:MM" string to a UTC "HH:MM" string, snapped to the nearest 30-min boundary. */
export function localTimeToUTC(hhmm: string): string {
  if (!/^\d{2}:\d{2}$/.test(hhmm)) {
    // eslint-disable-next-line no-console
    console.warn(`localTimeToUTC: unexpected format "${hhmm}", defaulting to 07:00`);
    return '07:00';
  }
  const parts = hhmm.split(':');
  const h = Number(parts[0] ?? 0);
  const m = Number(parts[1] ?? 0);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return snapToHalfHour(d.getUTCHours() * 60 + d.getUTCMinutes());
}
