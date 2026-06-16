import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDigest } from './useDigest';
import { useGlobalHeadlines } from './useGlobalHeadlines';
import { useCurrencyRates } from './useCurrencyRates';
import { sortedSelectedRegions } from '../data';
import { useAppStore } from '../store';
import { config, globalHeadlineMax } from '../config';
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

/**
 * Defensive cap so a previously-stored global count larger than the cron's
 * `globalHeadlineMax` can't over-request more stories than the cron produces.
 */
export function clampGlobalHeadlineCount(stored: number, max: number): number {
  return Math.min(stored, max);
}

/**
 * Holds a value steady while the Settings screen is open, re-settling to the live
 * value on return. The digest pages stay mounted behind Settings, so without this a
 * region/count edit changes the React Query key and refetches both visible-window
 * pages on every toggle — janking the (invisible) digest mid-interaction. Mirrors the
 * currency-query pause below: settle once on leaving Settings.
 */
function useSettledWhileSettings<T>(value: T): T {
  const inSettings = useAppStore((s) => s.screen === 'settings');
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    if (!inSettings) setSettled(value);
  }, [inSettings, value]);
  return settled;
}

export function useDigestPageData(date: string, isToday: boolean, currencyRatesEnabled: boolean) {
  const selectedRegions = useSettledWhileSettings(useAppStore((s) => s.prefs.selectedRegions));
  const headlineCount = useSettledWhileSettings(useAppStore((s) => s.prefs.headlineCount));
  const regionHeadlineCounts = useSettledWhileSettings(
    useAppStore((s) => s.prefs.regionHeadlineCounts),
  );
  const historyDays = useAppStore((s) => s.prefs.historyDays);
  const showGlobalHeadlines = useAppStore((s) => s.prefs.showGlobalHeadlines);
  const globalHeadlineCount = useAppStore((s) => s.prefs.globalHeadlineCount);
  const showCurrencyRates = useAppStore((s) => s.prefs.showCurrencyRates);
  const baseCurrency = useAppStore((s) => s.prefs.baseCurrency);

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
    () =>
      globalHeadlines.slice(0, clampGlobalHeadlineCount(globalHeadlineCount, globalHeadlineMax)),
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
    showCurrencyRates && isToday && currencyRatesEnabled,
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
