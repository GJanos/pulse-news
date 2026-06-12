import path from 'path';
import fs from 'fs';
import { loadPulseConfig } from '../config';

describe('loadPulseConfig validation', () => {
  const tmpPath = path.join(__dirname, '_test_pulse.config.json');

  afterEach(() => {
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
  });

  function writeConfig(override: object): void {
    fs.writeFileSync(tmpPath, JSON.stringify({ cron: override }), 'utf8');
  }

  it('accepts the default config without throwing', () => {
    expect(() => loadPulseConfig()).not.toThrow();
  });

  it('throws when regions list is empty', () => {
    writeConfig({ api: { regions: [] } });
    expect(() => loadPulseConfig(tmpPath)).toThrow('regions must be a non-empty array');
  });

  it('throws when fetch count is less than 1', () => {
    writeConfig({ api: { fetch: { count: 0 } } });
    expect(() => loadPulseConfig(tmpPath)).toThrow('api.fetch.count must be >= 1');
  });

  it('throws when recencySequence is empty', () => {
    writeConfig({ api: { fetch: { recencySequence: [] } } });
    expect(() => loadPulseConfig(tmpPath)).toThrow('api.fetch.recencySequence must be non-empty');
  });

  it('throws when evictDays is less than 1', () => {
    writeConfig({ db: { evictDays: 0 } });
    expect(() => loadPulseConfig(tmpPath)).toThrow('db.evictDays must be >= 1');
  });
});
