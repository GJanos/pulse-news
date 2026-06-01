import { useCallback, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { isoDateAtDayIndex } from '../data';
import { getLogger } from '../logger';

const log = getLogger('useCurrencyRates');

/** Intentional improvement: 5 minutes (legacy was 60 minutes). */
const STALE_MS = 5 * 60_000;

export interface CurrencyRate {
  rate: number;
  changePercent: number | null;
}

const EMPTY_RATES: Record<string, CurrencyRate> = {};

function currencyUrls(base: string, date: 'latest' | string): [string, string] {
  const key = base.toLowerCase();
  return [
    `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${date}/v1/currencies/${key}.json`,
    `https://${date}.currency-api.pages.dev/v1/currencies/${key}.json`,
  ];
}

export interface RateSnapshot {
  /** Publication date of this snapshot (YYYY-MM-DD), read from the payload. */
  date: string;
  rates: Record<string, number>;
}

export async function fetchRates(
  base: string,
  date: 'latest' | string,
): Promise<RateSnapshot | null> {
  const key = base.toLowerCase();
  const urls = currencyUrls(base, date);
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        log.warn(`currency fetch failed: HTTP ${res.status} (${url})`);
        continue;
      }
      const json = (await res.json()) as Record<string, unknown>;
      const rates = json[key];
      if (rates && typeof rates === 'object') {
        return {
          date: typeof json.date === 'string' ? json.date : '',
          rates: rates as Record<string, number>,
        };
      }
    } catch (e) {
      log.warn(`currency fetch threw: ${String(e)} (${url})`);
    }
  }
  return null;
}

/** Returns the YYYY-MM-DD date one day before the given ISO date (UTC). */
function isoDayBefore(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Exported for unit testing. Fetches today + yesterday rates and builds the CurrencyRate map. */
export async function buildCurrencyRates(
  codes: string[],
  baseCurrency: string,
): Promise<Record<string, CurrencyRate>> {
  const today = await fetchRates(baseCurrency, 'latest');
  if (!today) {
    log.warn(`today rates unavailable for ${baseCurrency} — returning {}`);
    return {};
  }
  // Anchor "yesterday" to the latest snapshot's own publication date rather than
  // the device clock. The @latest CDN entry can lag the local date by a day, and
  // a clock-derived yesterday would then resolve to the very same published file
  // as latest — reporting a flat 0% for every currency. Fall back to the clock
  // only if the payload carries no usable date.
  const yesterdayDate = /^\d{4}-\d{2}-\d{2}$/.test(today.date)
    ? isoDayBefore(today.date)
    : isoDateAtDayIndex(1);
  log.info(
    `fetching ${baseCurrency} rates for [${codes.join(', ')}] (today=${today.date || 'latest'} yesterday=${yesterdayDate})`,
  );
  const yesterday = await fetchRates(baseCurrency, yesterdayDate);
  if (!yesterday) {
    log.warn(
      `yesterday (${yesterdayDate}) rates unavailable for ${baseCurrency} — change % will be null`,
    );
  }
  const result: Record<string, CurrencyRate> = {};
  const summary: string[] = [];
  for (const code of codes) {
    if (code === baseCurrency) continue;
    const key = code.toLowerCase();
    const rate = today.rates[key];
    if (rate == null) {
      log.warn(`no ${code} (${key}) rate in ${baseCurrency} response — skipping`);
      continue;
    }
    const prevRate = yesterday?.rates[key] ?? null;
    const changePercent = prevRate != null ? ((prevRate - rate) / prevRate) * 100 : null;
    log.debug(
      `  ${code}: today=${rate} yesterday=${prevRate ?? 'n/a'} change=${changePercent != null ? changePercent.toFixed(3) + '%' : 'null'}`,
    );
    summary.push(`${code}=${changePercent != null ? changePercent.toFixed(2) + '%' : 'n/a'}`);
    result[code] = { rate, changePercent };
  }
  const withChange = Object.values(result).filter((r) => r.changePercent != null).length;
  log.info(
    `${baseCurrency} rates ready: ${Object.keys(result).length} currencies, change data ${withChange}/${Object.keys(result).length} [${summary.join(' ')}]`,
  );
  return result;
}

export function formatRate(rate: number): string {
  if (rate >= 10_000) return Math.round(rate).toLocaleString('en-US');
  if (rate >= 100) return Math.round(rate).toString();
  if (rate >= 10) return rate.toFixed(2);
  if (rate >= 1) return rate.toFixed(3);
  return rate.toFixed(3);
}

export interface UseCurrencyRatesResult {
  rates: Record<string, CurrencyRate>;
  forceRefresh: () => void;
}

export function useCurrencyRates(
  codes: string[],
  enabled: boolean,
  baseCurrency = 'USD',
): UseCurrencyRatesResult {
  const codesKey = codes.slice().sort().join(',');
  const forcedRef = useRef(false);
  // React Query retains the last successful `data` even after a query is
  // disabled, so a hook viewing an older (non-today) digest would otherwise keep
  // serving today's cached rates. Gate every read on `active` to clear them.
  const active = enabled && codesKey !== '';

  const query = useQuery<Record<string, CurrencyRate>>({
    queryKey: ['currency', baseCurrency, codesKey],
    enabled: active,
    staleTime: STALE_MS,
    gcTime: 60 * 60_000,
    queryFn: async () => {
      forcedRef.current = false;
      return buildCurrencyRates(codes, baseCurrency);
    },
    throwOnError: false,
  });

  const forceRefresh = useCallback(() => {
    if (!enabled) return;
    forcedRef.current = true;
    void query.refetch();
  }, [enabled, query]);

  return {
    rates: active ? (query.data ?? EMPTY_RATES) : EMPTY_RATES,
    forceRefresh,
  };
}
