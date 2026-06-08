import { globalHeadlineMax } from '../config';
import rawConfig from '@pulse/shared/pulse.config.json';
import appJson from '../../app.json';

describe('config — globalHeadlineMax', () => {
  it('resolves to the cron global ranking count', () => {
    expect(globalHeadlineMax).toBe(rawConfig.cron.api.ranking.global.count);
  });

  it('equals the default global headline count (5)', () => {
    expect(globalHeadlineMax).toBe(5);
  });
});

describe('app.json branding', () => {
  it('expo.name is "Pulse News"', () => {
    expect(appJson.expo.name).toBe('Pulse News');
  });
});
