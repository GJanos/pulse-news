import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { getTodayISO } from '../data';

/**
 * Today's UTC date as YYYY-MM-DD, kept fresh across background→foreground
 * transitions. Screens that stay mounted while the app sleeps past midnight
 * (e.g. the digest pager reopened from the next morning's notification) would
 * otherwise keep rendering — and refetching — yesterday's date until the app
 * is killed and relaunched.
 */
export function useTodayISO(): string {
  const [today, setToday] = useState(getTodayISO);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      const now = getTodayISO();
      setToday((prev) => (prev === now ? prev : now));
    });
    return () => sub.remove();
  }, []);
  return today;
}
