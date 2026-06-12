/* eslint-disable @typescript-eslint/no-var-requires */
import type { PulseConfig } from '@shared/config';

describe('loadPulseConfig', () => {
  it('loads shared/pulse.config.json and returns a valid PulseConfig', () => {
    const { loadPulseConfig } = require('../config');
    const cfg: PulseConfig = loadPulseConfig();
    expect(cfg.model.name).toBeTruthy();
    expect(Array.isArray(cfg.api.regions)).toBe(true);
    expect(cfg.api.regions.length).toBeGreaterThan(0);
    expect(typeof cfg.api.fetch.count).toBe('number');
    expect(typeof cfg.db.evict).toBe('boolean');
    expect(['debug', 'info', 'warn', 'error']).toContain(cfg.log.level);
  });

  it('falls back to defaultConfig when config file is absent', () => {
    const { loadPulseConfig } = require('../config');
    const cfg: PulseConfig = loadPulseConfig('/nonexistent/pulse.config.json');
    expect(cfg.model.name).toBe('sonar');
  });
});

describe('mergeConfig', () => {
  it('returns defaults unchanged when overrides is empty', () => {
    const { mergeConfig, defaultConfig } = require('../config');
    const result = mergeConfig(defaultConfig, {});
    expect(result.model.name).toBe('sonar');
    expect(result.db.evict).toBe(true);
  });

  it('deep-merges a partial override without clobbering sibling keys', () => {
    const { mergeConfig, defaultConfig } = require('../config');
    const result = mergeConfig(defaultConfig, { model: { name: 'sonar-pro' } });
    expect(result.model.name).toBe('sonar-pro');
    expect(result.model.temperature).toBe(0.2);
  });

  it('replaces arrays outright rather than merging them', () => {
    const { mergeConfig, defaultConfig } = require('../config');
    const result = mergeConfig(defaultConfig, { api: { regions: ['Hungary'] } });
    expect(result.api.regions).toEqual(['Hungary']);
    expect(result.api.fetch.count).toBe(5); // sibling untouched
  });
});
