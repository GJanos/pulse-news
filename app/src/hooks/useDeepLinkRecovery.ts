import { useEffect, useRef } from 'react';
import * as Linking from 'expo-linking';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getLogger } from '../logger';

const log = getLogger('useDeepLinkRecovery');

const RECOVERY_PREFIX = 'pulse://reset-password';
const CONFIRM_PREFIX = 'pulse://confirm';

type RecoveryPayload =
  | { type: 'pkce'; code: string; isRecovery: boolean }
  | { type: 'implicit'; accessToken: string; refreshToken: string; isRecovery: boolean };

export function parseRecoveryPayload(url: string): RecoveryPayload | null {
  const isRecoveryUrl = url.startsWith(RECOVERY_PREFIX);
  if (!isRecoveryUrl && !url.startsWith(CONFIRM_PREFIX)) {
    return null;
  }
  const codeMatch = url.match(/[?&]code=([^&#]+)/);
  if (codeMatch?.[1]) {
    return { type: 'pkce', code: decodeURIComponent(codeMatch[1]), isRecovery: isRecoveryUrl };
  }
  const hash = url.split('#')[1] ?? '';
  const params = new URLSearchParams(hash);
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  if (accessToken && refreshToken) {
    return {
      type: 'implicit',
      accessToken,
      refreshToken,
      isRecovery: isRecoveryUrl && params.get('type') === 'recovery',
    };
  }
  return null;
}

export function useDeepLinkRecovery(
  supabase: SupabaseClient | null,
  onRecoveryStart: () => void,
): void {
  const lastUrlRef = useRef<string | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (!supabase) return;
    let mounted = true;

    const handleUrl = async (url: string): Promise<void> => {
      const payload = parseRecoveryPayload(url);
      if (!payload || !mounted) return;
      if (lastUrlRef.current === url) {
        log.debug('skipping duplicate deep link');
        return;
      }
      lastUrlRef.current = url;
      const requestId = ++requestIdRef.current;

      log.info(`deep link received: ${url}`);
      if (payload.type === 'pkce') {
        if (payload.isRecovery) {
          log.info('recovery code received (PKCE) — exchanging for session');
          onRecoveryStart();
        } else {
          // Sign-up confirmation: exchange establishes the session and the
          // resulting SIGNED_IN event routes the user into the app.
          log.info('confirmation code received (PKCE) — exchanging for session');
        }
        const { error } = await supabase.auth.exchangeCodeForSession(payload.code);
        if (!mounted || requestId !== requestIdRef.current) return;
        if (error) log.warn(`exchangeCodeForSession failed: ${error.message}`);
      } else {
        log.info('recovery tokens received (implicit) — setting session');
        const { error } = await supabase.auth.setSession({
          access_token: payload.accessToken,
          refresh_token: payload.refreshToken,
        });
        if (!mounted || requestId !== requestIdRef.current) return;
        if (error) {
          log.warn(`setSession failed: ${error.message}`);
        } else if (payload.isRecovery) {
          onRecoveryStart();
        }
      }
    };

    const loadInitialUrl = async (): Promise<void> => {
      try {
        const url = await Linking.getInitialURL();
        if (url) await handleUrl(url);
      } catch (e) {
        log.warn(`getInitialURL failed: ${String(e)}`);
      }
    };

    loadInitialUrl();
    const sub = Linking.addEventListener('url', ({ url }) => {
      void handleUrl(url);
    });
    return () => {
      mounted = false;
      sub.remove();
    };
    // onRecoveryStart accesses getState() directly — always fresh, safe to omit from deps
  }, [supabase]);
}
