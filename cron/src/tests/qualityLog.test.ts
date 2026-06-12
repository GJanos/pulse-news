import fs from 'fs';
import os from 'os';
import path from 'path';
import { buildLogPath, appendRunLog } from '../qualityLog';
import type { RunConfig, RunLog } from '../qualityLog';

const baseRunConfig: RunConfig = {
  model: 'sonar-pro',
  reasoningEffort: 'medium',
  temperature: 0,
  searchType: 'news',
  searchContextSize: 'high',
  summarySentences: 2,
  detailSentences: 2,
  maxFetchAttempts: 3,
  minFetchResults: 3,
  fetchBuffer: 2,
};

describe('buildLogPath', () => {
  it('builds a deterministic filename from runConfig and country codes', () => {
    const p = buildLogPath(baseRunConfig, ['GB']);
    expect(p).toContain('m=sonar-pro');
    expect(p).toContain('r=medium');
    expect(p).toContain('s=news');
    expect(p).toContain('.jsonl');
  });

  it('includes all country codes joined by comma', () => {
    const p = buildLogPath(baseRunConfig, ['GB', 'DE', 'FR']);
    expect(p).toContain('p=GB,DE,FR');
  });
});

describe('appendRunLog', () => {
  let tmpDir: string;
  let logPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-test-'));
    logPath = path.join(tmpDir, 'test-run.jsonl');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const makeRunLog = (): RunLog => ({
    runAt: new Date().toISOString(),
    runConfig: baseRunConfig,
    regions: ['GB'],
    digests: [],
    failedRegions: [],
    totals: {
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      costUsd: 0.001,
      headlinesFetched: 3,
      headlinesRequested: 3,
      durationMs: 1200,
    },
  });

  it('creates the log file and writes a valid JSON line', () => {
    const log = makeRunLog();
    appendRunLog(log, logPath);

    expect(fs.existsSync(logPath)).toBe(true);
    const line = fs.readFileSync(logPath, 'utf8').trim();
    const parsed = JSON.parse(line) as RunLog;
    expect(parsed.regions).toEqual(['GB']);
    expect(parsed.totals.totalTokens).toBe(150);
  });

  it('appends a second line without overwriting the first', () => {
    appendRunLog(makeRunLog(), logPath);
    appendRunLog(makeRunLog(), logPath);

    const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    lines.forEach((line) => expect(() => JSON.parse(line)).not.toThrow());
  });

  it('creates intermediate directories if they do not exist', () => {
    const nestedPath = path.join(tmpDir, 'nested', 'deep', 'run.jsonl');
    appendRunLog(makeRunLog(), nestedPath);
    expect(fs.existsSync(nestedPath)).toBe(true);
  });
});
