import type * as ClientModule from '../../supabase/client';

const ORIGINAL_ENV = process.env;

function loadClient(env: Record<string, string | undefined>, dev: boolean) {
  process.env = { ...ORIGINAL_ENV, ...env };
  (global as { __DEV__?: boolean }).__DEV__ = dev;
  let mod: typeof ClientModule | undefined;
  jest.isolateModules(() => {
    mod = require('../../supabase/client');
  });
  return mod!;
}

afterEach(() => {
  process.env = ORIGINAL_ENV;
  (global as { __DEV__?: boolean }).__DEV__ = true;
});

const UNCONFIGURED = { EXPO_PUBLIC_SUPABASE_URL: '', EXPO_PUBLIC_SUPABASE_KEY: '' };
const CONFIGURED = {
  EXPO_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
  EXPO_PUBLIC_SUPABASE_KEY: 'pk',
};

describe('getSupabase', () => {
  it('returns null in dev when env vars are missing (local-only mode)', () => {
    const { getSupabase, isSupabaseConfigured } = loadClient(UNCONFIGURED, true);
    expect(getSupabase()).toBeNull();
    expect(isSupabaseConfigured()).toBe(false);
  });

  it('throws in a release build when env vars are missing', () => {
    const { getSupabase } = loadClient(UNCONFIGURED, false);
    expect(() => getSupabase()).toThrow(/release build/);
  });

  it('returns a client in a release build when configured', () => {
    const { getSupabase, isSupabaseConfigured } = loadClient(CONFIGURED, false);
    expect(getSupabase()).not.toBeNull();
    expect(isSupabaseConfigured()).toBe(true);
  });
});
