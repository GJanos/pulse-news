import { storage } from './mmkv';
import type { UserPreferences } from '../types';
import { getSupabase } from '../supabase/client';
import { getLogger } from '../logger';

const log = getLogger('preferences');

const STORAGE_KEY = 'pulse.preferences.v1';

export const DEFAULT_PREFERENCES: UserPreferences = {
  selectedRegions: ['Hungary', 'Ukraine', 'Russia', 'United States', 'United Kingdom'],
  headlineCount: 5,
  regionHeadlineCounts: {},
  historyDays: 7,
  notifyTime: '07:30',
  openLinksIn: 'in-app',
  regionStyle: 'flag',
  imagesEnabled: true,
  showSummaries: true,
  photoCount: 2,
  baseCurrency: 'USD',
  showCurrencyRates: false,
  showGlobalHeadlines: true,
  globalHeadlineCount: 5,
  theme: 'dark',
  aesthetic: 'editorial',
  updatedAt: new Date(0).toISOString(),
};

export async function loadLocalPreferences(): Promise<UserPreferences | null> {
  try {
    const raw = storage.getString(STORAGE_KEY);
    if (!raw) {
      log.debug('no local cache found — defaults will be used');
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<UserPreferences>;
    const merged = { ...DEFAULT_PREFERENCES, ...parsed };
    log.debug(`loaded from local cache (updatedAt: ${merged.updatedAt})`);
    return merged;
  } catch {
    log.warn('failed to parse local preferences — resetting to defaults');
    return null;
  }
}

export async function saveLocalPreferences(prefs: UserPreferences): Promise<void> {
  try {
    storage.set(STORAGE_KEY, JSON.stringify(prefs));
    log.debug(`saved to local cache (updatedAt: ${prefs.updatedAt})`);
  } catch {
    log.warn('failed to save preferences to local cache');
  }
}

export async function pullRemotePreferences(userId: string): Promise<UserPreferences | null> {
  const supabase = getSupabase();
  if (!supabase) return null;

  // TODO: remove cast when supabase types include user_preferences table
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('user_preferences')
    .select('preferences, updated_at')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) {
    log.warn(`pullRemotePreferences failed: ${error.message}`);
    return null;
  }
  if (!data) return null;
  return {
    ...DEFAULT_PREFERENCES,
    ...(data.preferences as Partial<UserPreferences>),
    updatedAt: data.updated_at as string,
  };
}

export async function pushRemotePreferences(userId: string, prefs: UserPreferences): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;

  // TODO: remove cast when supabase types include user_preferences table
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from('user_preferences')
    .upsert(
      { user_id: userId, preferences: prefs, updated_at: prefs.updatedAt },
      { onConflict: 'user_id' },
    );
  if (error) throw new Error(`pushRemotePreferences failed: ${error.message}`);
}

export function resolveConflict(
  local: UserPreferences | null,
  remote: UserPreferences | null,
): UserPreferences {
  if (!local && !remote) return DEFAULT_PREFERENCES;
  if (!local) return remote!;
  if (!remote) return local;
  const winner = new Date(remote.updatedAt) > new Date(local.updatedAt) ? remote : local;
  log.debug(`conflict resolved: ${winner === remote ? 'remote' : 'local'} wins`);
  return winner;
}

export async function syncPreferences(userId: string): Promise<UserPreferences> {
  log.info(`syncing preferences for user ${userId.slice(0, 8)}…`);

  const [local, remote] = await Promise.all([
    loadLocalPreferences(),
    pullRemotePreferences(userId),
  ]);
  const winner = resolveConflict(local, remote);

  if (winner !== local) {
    await saveLocalPreferences(winner);
    log.info('sync: remote was newer — local cache updated');
  } else if (local && remote && new Date(local.updatedAt) > new Date(remote.updatedAt)) {
    pushRemotePreferences(userId, local).catch((e) => log.warn(`remote push failed: ${String(e)}`));
    log.info('sync: local was newer — remote push queued');
  }

  return winner;
}
