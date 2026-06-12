const WINDOW_RE = /^\d{2}:\d{2}:\d{2}$/;

/**
 * Returns UTC HH:MM:SS boundaries for the 30-minute window ending at now.
 *
 * Honours NOTIFY_WINDOW_START / NOTIFY_WINDOW_END when both are set and
 * well-formed: the Actions guard step (.github/workflows/notify.yml) passes
 * the window it already queried, so the guard and the job can never straddle
 * a half-hour boundary and disagree about which devices are due.
 */
export function notifyWindow(): { start: string; end: string } {
  const envStart = process.env.NOTIFY_WINDOW_START;
  const envEnd = process.env.NOTIFY_WINDOW_END;
  if (envStart && envEnd && WINDOW_RE.test(envStart) && WINDOW_RE.test(envEnd)) {
    return { start: envStart, end: envEnd };
  }

  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const fmt = (d: Date) => `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:00`;
  return {
    start: fmt(new Date(now.getTime() - 30 * 60 * 1000)),
    end: fmt(now),
  };
}
