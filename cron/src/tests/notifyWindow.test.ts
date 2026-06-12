import { notifyWindow } from '../lib/notifyWindow';

describe('notifyWindow', () => {
  it('returns start and end as UTC HH:MM:00 strings', () => {
    const { start, end } = notifyWindow();
    expect(start).toMatch(/^\d{2}:\d{2}:00$/);
    expect(end).toMatch(/^\d{2}:\d{2}:00$/);
  });

  it('start is exactly 30 minutes before end', () => {
    const { start, end } = notifyWindow();
    const toMinutes = (t: string) => {
      const [h, m] = t.split(':').map(Number);
      return h! * 60 + m!;
    };
    const diff = (toMinutes(end) - toMinutes(start) + 24 * 60) % (24 * 60);
    expect(diff).toBe(30);
  });

  it('end reflects current UTC HH:MM', () => {
    const before = new Date();
    const { end } = notifyWindow();
    const after = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const fmtMinute = (d: Date) => `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:00`;
    expect([fmtMinute(before), fmtMinute(after)]).toContain(end);
  });

  it('handles midnight rollover: at 00:10 UTC, start is 23:40', () => {
    jest.useFakeTimers();
    // 00:10:30 UTC
    jest.setSystemTime(new Date('2024-01-15T00:10:30Z'));
    const { start, end } = notifyWindow();
    expect(end).toBe('00:10:00');
    expect(start).toBe('23:40:00');
    jest.useRealTimers();
  });

  it('handles hour boundary: at 13:00 UTC, start is 12:30', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2024-01-15T13:00:00Z'));
    const { start, end } = notifyWindow();
    expect(end).toBe('13:00:00');
    expect(start).toBe('12:30:00');
    jest.useRealTimers();
  });

  describe('NOTIFY_WINDOW_START / NOTIFY_WINDOW_END override', () => {
    afterEach(() => {
      delete process.env.NOTIFY_WINDOW_START;
      delete process.env.NOTIFY_WINDOW_END;
    });

    it('returns the window passed by the Actions guard step', () => {
      process.env.NOTIFY_WINDOW_START = '08:30:00';
      process.env.NOTIFY_WINDOW_END = '09:00:00';
      expect(notifyWindow()).toEqual({ start: '08:30:00', end: '09:00:00' });
    });

    it('falls back to the computed window on a malformed override', () => {
      process.env.NOTIFY_WINDOW_START = 'garbage';
      process.env.NOTIFY_WINDOW_END = '09:00:00';
      const { start, end } = notifyWindow();
      expect(start).not.toBe('garbage');
      expect(start).toMatch(/^\d{2}:\d{2}:00$/);
      expect(end).toMatch(/^\d{2}:\d{2}:00$/);
    });

    it('falls back to the computed window on a partial override', () => {
      process.env.NOTIFY_WINDOW_END = '09:00:00';
      const { start, end } = notifyWindow();
      expect(start).toMatch(/^\d{2}:\d{2}:00$/);
      expect(end).toMatch(/^\d{2}:\d{2}:00$/);
    });
  });
});
