import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { supabaseStorage } from '../storage/mmkv';
import { getLogger } from '../logger';

const log = getLogger('supabase');

// EXPO_PUBLIC_* vars are baked into the bundle by Metro at build time.
// Only the publishable key belongs here — secret key is cron-side only.
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_KEY = process.env.EXPO_PUBLIC_SUPABASE_KEY ?? '';

let _client: SupabaseClient | null = null;
let _warnedUnconfigured = false;

/**
 * Returns the shared Supabase client. Lazy so the app can boot even when
 * env vars aren't set yet (during early scaffolding).
 *
 * Returns null when not configured — callers must handle this and fall
 * back to local-only behaviour. Release builds throw instead: a release APK
 * built from a bad .env would otherwise ship silently with no backend.
 */
export function getSupabase(): SupabaseClient | null {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    if (!__DEV__) {
      throw new Error(
        'Supabase not configured in a release build — set EXPO_PUBLIC_SUPABASE_URL + EXPO_PUBLIC_SUPABASE_KEY in app/.env and rebuild',
      );
    }
    if (!_warnedUnconfigured) {
      log.warn(
        'Supabase not configured — running in local-only mode (set EXPO_PUBLIC_SUPABASE_URL + EXPO_PUBLIC_SUPABASE_KEY in app/.env)',
      );
      _warnedUnconfigured = true;
    }
    return null;
  }
  if (!_client) {
    _client = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: {
        storage: supabaseStorage,
        autoRefreshToken: true,
        persistSession: true,
        // Mobile clients don't use URL-based session detection (web only).
        detectSessionInUrl: false,
      },
    });
    log.debug(`client initialized for ${SUPABASE_URL}`);
  }
  return _client;
}

/** Returns true when both SUPABASE_URL and SUPABASE_KEY are present. */
export function isSupabaseConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_KEY);
}
