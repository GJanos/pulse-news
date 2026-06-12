import fs from 'fs';
import path from 'path';
import type { DigestQuality } from './types';

/** Model and search parameters that were active for a given run. */
export interface RunConfig {
  model: string;
  reasoningEffort: string;
  temperature: number;
  searchType: string;
  searchContextSize: string;
  summarySentences: number;
  detailSentences: number;
  maxFetchAttempts: number;
  minFetchResults: number;
  fetchBuffer: number;
}

/** One complete pipeline run, written as a single JSON line to the log file. */
export interface RunLog {
  runAt: string;
  runConfig: RunConfig;
  regions: string[];
  digests: DigestQuality[];
  failedRegions: string[];
  totals: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    costUsd: number;
    headlinesFetched: number;
    headlinesRequested: number;
    durationMs: number;
  };
}

/**
 * Returns the JSONL log file path for the given config and ISO country codes.
 * Runs with identical parameters append to the same file, forming a time-series.
 */
export function buildLogPath(runConfig: RunConfig, countryCodes: string[]): string {
  const p = countryCodes.join(',');
  const name = `m=${runConfig.model}-r=${runConfig.reasoningEffort}-s=${runConfig.searchType}-c=${runConfig.searchContextSize}-p=${p}.jsonl`;
  return path.join(__dirname, '..', 'logs', name);
}

/** Appends one run record as a JSON line to the log file, creating it and its directory if needed. */
export function appendRunLog(log: RunLog, logPath: string): void {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.appendFileSync(logPath, JSON.stringify(log) + '\n', 'utf8');
}
