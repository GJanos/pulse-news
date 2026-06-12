// ── Shared ──────────────────────────────────────────────────────────

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

// ── App config ──────────────────────────────────────────────────────

export interface AppConfig {
  screenStateTtlMs: number;
  splashAdvanceMs: number;
  deviceRegistrationTimeoutMs: number;
  prefsDebounceMs: number;
  logLevel: LogLevel;
  digestStaleMins: number;
  currencyStaleMins: number;
  fetchCount: number;
}

// ── Cron config ─────────────────────────────────────────────────────

export interface ModelConfig {
  name: string;
  reasoningEffort: string;
  temperature: number;
  searchType: string;
  searchContextSize: string;
}

export interface FetchConfig {
  count: number;
  summarySentences: number;
  detailSentences: number;
  maxAttempts: number;
  attemptDelay: number;
  retryDelay: number;
  minResults: number;
  recencySequence: Array<'hour' | 'day' | 'week' | 'month' | 'year'>;
  buffer: number;
  /** Number of leading retry rounds that pass the region's curated source domains
   *  as a hard `search_domain_filter` allowlist. Later rounds drop the filter so a
   *  quiet news day can still fill the digest from the open web. 0 disables. */
  domainFilterRounds: number;
}

export interface RankingLocalConfig {
  enabled: boolean;
  model: string;
  maxTokens: number;
}

export interface RankingGlobalConfig {
  enabled: boolean;
  count: number;
  model: string;
  maxTokens: number;
  chunkSize: number;
}

export interface RankingConfig {
  local: RankingLocalConfig;
  global: RankingGlobalConfig;
}

export interface ApiConfig {
  regions: string[];
  fetch: FetchConfig;
  ranking: RankingConfig;
}

export interface DbConfig {
  evict: boolean;
  evictDays: number;
  evictUsageDays: number;
}

export interface LogConfig {
  level: LogLevel;
  qualityLog: boolean;
}

export interface PulseConfig {
  model: ModelConfig;
  api: ApiConfig;
  db: DbConfig;
  log: LogConfig;
}

// ── Top-level wrapper ────────────────────────────────────────────────

export interface SharedConfig {
  app: AppConfig;
  cron: PulseConfig;
}
