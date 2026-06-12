import fs from 'fs';
import path from 'path';
import type { PulseConfig } from '@shared/config';
import type { DigestSource } from './types';
import { REGIONS } from '@shared/regions';
import { PerplexitySource } from './fetchNews';
import { configureLogger, getLogger } from './logging';

// ── Defaults ─────────────────────────────────────────────────────────────────

export const defaultConfig: PulseConfig = {
  model: {
    name: 'sonar',
    reasoningEffort: 'low',
    temperature: 0.2,
    searchType: 'pro',
    searchContextSize: 'medium',
  },
  api: {
    regions: REGIONS.map((r) => r.region),
    fetch: {
      count: 5,
      summarySentences: 1,
      detailSentences: 3,
      maxAttempts: 4,
      attemptDelay: 2000,
      retryDelay: 1000,
      minResults: 5,
      // Day-only on purpose: widening to week/month resurfaces stale stories.
      // Repeated 'day' rounds still help — the live search index returns
      // different candidates per call.
      recencySequence: ['day', 'day', 'day', 'day', 'day', 'day'],
      domainFilterRounds: 2,
      buffer: 0,
    },
    ranking: {
      local: {
        enabled: true,
        model: 'claude-sonnet-4-6',
        maxTokens: 256,
      },
      global: {
        enabled: false,
        count: 5,
        model: 'claude-sonnet-4-6',
        maxTokens: 512,
        chunkSize: 40,
      },
    },
  },
  db: {
    evict: true,
    evictDays: 7,
    evictUsageDays: 90,
  },
  log: {
    level: 'info',
    qualityLog: true,
  },
};

// ── Config loading ────────────────────────────────────────────────────────────

function validateConfig(config: PulseConfig): void {
  if (!Array.isArray(config.api.regions) || config.api.regions.length === 0) {
    throw new Error('pulse.config.json: regions must be a non-empty array');
  }
  if (config.api.fetch.count < 1) {
    throw new Error('pulse.config.json: api.fetch.count must be >= 1');
  }
  if (
    !Array.isArray(config.api.fetch.recencySequence) ||
    config.api.fetch.recencySequence.length === 0
  ) {
    throw new Error('pulse.config.json: api.fetch.recencySequence must be non-empty');
  }
  if (config.db.evictDays < 1) {
    throw new Error('pulse.config.json: db.evictDays must be >= 1');
  }
  if (config.db.evictUsageDays < 1) {
    throw new Error('pulse.config.json: db.evictUsageDays must be >= 1');
  }
}

export function loadPulseConfig(configPath?: string): PulseConfig {
  // pulse.config.json lives in shared/ (moved from cron/ in Phase 1)
  const resolvedPath =
    configPath ?? path.resolve(__dirname, '..', '..', 'shared', 'pulse.config.json');

  const config: PulseConfig = structuredClone(defaultConfig);

  if (fs.existsSync(resolvedPath)) {
    const raw = fs.readFileSync(resolvedPath, 'utf8');
    const parsed = (JSON.parse(raw) as { cron?: Partial<PulseConfig> }).cron ?? {};
    const merged = mergeConfig(defaultConfig, parsed);
    configureLogger(merged);
    validateConfig(merged);
    return merged;
  }

  configureLogger(config);
  validateConfig(config);
  return config;
}

// ── Merge helper ──────────────────────────────────────────────────────────────

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function mergeConfig<T>(defaults: T, overrides: Partial<T>): T {
  if (!isObject(defaults) || !isObject(overrides)) {
    return (overrides as T) ?? defaults;
  }

  const merged = { ...defaults } as Record<string, unknown>;

  for (const key of Object.keys(overrides) as Array<keyof T>) {
    const keyStr = key as string;
    const defVal = (defaults as Record<string, unknown>)[keyStr];
    const ovVal = (overrides as Record<string, unknown>)[keyStr];

    if (isObject(defVal) && isObject(ovVal)) {
      merged[keyStr] = mergeConfig(defVal, ovVal as Partial<typeof defVal>);
    } else if (ovVal !== undefined) {
      merged[keyStr] = ovVal;
    }
  }

  return merged as T;
}

// ── Source factory ────────────────────────────────────────────────────────────

export function createSource(config: PulseConfig): DigestSource {
  const logger = getLogger('config');
  logger.debug(`initializing source for ${config.api.regions.length} regions`);
  return new PerplexitySource(config);
}
