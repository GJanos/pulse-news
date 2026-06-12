import { snapToHalfHour, localTimeToUTC } from '../../utils/time';

describe('snapToHalfHour', () => {
  it('returns exact boundary unchanged', () => {
    expect(snapToHalfHour(0)).toBe('00:00');
    expect(snapToHalfHour(30)).toBe('00:30');
    expect(snapToHalfHour(480)).toBe('08:00');
    expect(snapToHalfHour(510)).toBe('08:30');
  });

  it('rounds 14 min down to :00', () => {
    expect(snapToHalfHour(14)).toBe('00:00');
  });

  it('rounds 15 min up to :30 (JS Math.round ties up)', () => {
    expect(snapToHalfHour(15)).toBe('00:30');
  });

  it('rounds 135 min (NPT UTC+5:45 → 02:15) to 02:30', () => {
    expect(snapToHalfHour(135)).toBe('02:30');
  });

  it('wraps midnight: 1440 min snaps to 00:00', () => {
    expect(snapToHalfHour(1440)).toBe('00:00');
  });

  it('wraps 1435 min (23:55) up to 00:00 via midnight', () => {
    // 1435/30 = 47.83 → round → 48 → 1440 → 24:00 → 00:00
    expect(snapToHalfHour(1435)).toBe('00:00');
  });
});

describe('localTimeToUTC', () => {
  it('returns 07:00 fallback for empty string', () => {
    expect(localTimeToUTC('')).toBe('07:00');
  });

  it('returns 07:00 fallback for non-HH:MM input', () => {
    expect(localTimeToUTC('garbage')).toBe('07:00');
    expect(localTimeToUTC('8:00')).toBe('07:00');
    expect(localTimeToUTC('08:0')).toBe('07:00');
  });

  it('returns a valid HH:MM string for a valid input', () => {
    const result = localTimeToUTC('08:00');
    expect(result).toMatch(/^\d{2}:\d{2}$/);
  });

  it('output is always on a 30-min boundary (:00 or :30)', () => {
    for (const slot of ['06:00', '07:30', '12:00', '22:30']) {
      const result = localTimeToUTC(slot);
      const [, m] = result.split(':');
      expect(['00', '30']).toContain(m);
    }
  });
});
