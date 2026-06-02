import { useCallback, useMemo } from 'react';
import { useDigest } from './useDigest';
import { useGlobalHeadlines } from './useGlobalHeadlines';
import { useCurrencyRates } from './useCurrencyRates';
import { sortedSelectedRegions } from '../data';
import { useAppStore } from '../store';
import { config } from '../config';
import type { DailyDigest, Region, Headline } from '../types';

export interface VisibleBucket {
  region: Region;
  items: Headline[];
}

/** Exported pure function for unit testing. */
export function buildVisibleBuckets(
  digest: DailyDigest | undefined,
  selectedRegions: string[],
  headlineCount: number,
  regionHeadlineCounts: Record<string, number>,
): VisibleBucket[] {
  if (!digest) return [];
  return sortedSelectedRegions(selectedRegions)
    .map((r) => {
      const count = regionHeadlineCounts[r.region] ?? headlineCount;
      return { region: r, items: (digest.regions[r.region] ?? []).slice(0, count) };
    })
    .filter((b) => b.items.length > 0);
}

export function useDigestPageData(date: string, isToday: boolean) {
  const selectedRegions = useAppStore((s) => s.prefs.selectedRegions);
  const headlineCount = useAppStore((s) => s.prefs.headlineCount);
  const regionHeadlineCounts = useAppStore((s) => s.prefs.regionHeadlineCounts);
  const historyDays = useAppStore((s) => s.prefs.historyDays);
  const showGlobalHeadlines = useAppStore((s) => s.prefs.showGlobalHeadlines);
  const globalHeadlineCount = useAppStore((s) => s.prefs.globalHeadlineCount);
  const showCurrencyRates = useAppStore((s) => s.prefs.showCurrencyRates);
  const baseCurrency = useAppStore((s) => s.prefs.baseCurrency);
  const screen = useAppStore((s) => s.screen);

  const {
    digest,
    error,
    isLoading,
    forceRefresh: forceRefreshDigest,
  } = useDigest(date, selectedRegions, historyDays, config.digestStaleMins);
  const { headlines: globalHeadlines, forceRefresh: forceRefreshGlobal } = useGlobalHeadlines(
    date,
    showGlobalHeadlines,
    config.digestStaleMins,
  );

  const visible = useMemo(
    () => buildVisibleBuckets(digest, selectedRegions, headlineCount, regionHeadlineCounts),
    [digest, selectedRegions, headlineCount, regionHeadlineCounts],
  );

  const visibleGlobalHeadlines = useMemo(
    () => globalHeadlines.slice(0, globalHeadlineCount),
    [globalHeadlines, globalHeadlineCount],
  );

  const hasGlobal = showGlobalHeadlines && visibleGlobalHeadlines.length > 0;
  const totalHeadlines = useMemo(() => visible.reduce((n, b) => n + b.items.length, 0), [visible]);

  const currencyCodes = useMemo(
    () =>
      Array.from(new Set(visible.map((b) => b.region.currency).filter((c) => c !== baseCurrency))),
    [visible, baseCurrency],
  );
  // Pause the currency query while Settings is open so toggling a region (which
  // mutates the derived currencyCodes / React Query key) does not trigger a
  // mid-interaction refetch. Legacy settled only on leaving Settings; the query
  // fires once on return and skips the fetch entirely if codes are unchanged and
  // data is still within STALE_MS.
  const { rates: currencyRates, forceRefresh: forceRefreshCurrency } = useCurrencyRates(
    currencyCodes,
    showCurrencyRates && isToday && screen !== 'settings',
    baseCurrency,
  );

  const forceRefresh = useCallback((): Promise<void> => {
    forceRefreshGlobal();
    forceRefreshCurrency();
    return forceRefreshDigest();
  }, [forceRefreshDigest, forceRefreshGlobal, forceRefreshCurrency]);

  return {
    digest,
    error,
    isLoading,
    visible,
    globalHeadlines,
    visibleGlobalHeadlines,
    hasGlobal,
    totalHeadlines,
    currencyRates,
    forceRefresh,
  };
}
