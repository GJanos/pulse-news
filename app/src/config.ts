import rawConfig from '../../shared/pulse.config.json';

export const config = rawConfig.app as unknown as {
  screenStateTtlMs: number;
  splashAdvanceMs: number;
  deviceRegistrationTimeoutMs: number;
  prefsDebounceMs: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  digestStaleMins: number;
  currencyStaleMins: number;
  fetchCount: number;
};

/**
 * Hard cap on the global-headline count surfaced to the UI. Mirrors the cron's
 * `ranking.global.count`
 */
export const globalHeadlineMax: number = rawConfig.cron.api.ranking.global.count;

/** Base URL of the Vercel API (e.g. https://pulse-cron.vercel.app). Empty in dev = account ops unavailable. */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? '').replace(/\/$/, '');
