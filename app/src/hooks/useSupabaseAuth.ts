import { useEffect } from 'react';
import type { Session } from '@supabase/supabase-js';
import { getSupabase } from '../supabase/client';
import { storage } from '../storage/mmkv';
import { getLogger } from '../logger';
import { useDeepLinkRecovery } from './useDeepLinkRecovery';
import { useAppStore } from '../store';

const log = getLogger('useSupabaseAuth');

export interface SignUpResult {
  error: string | null;
  needsConfirmation: boolean;
}

export interface AuthActions {
  signIn: (email: string, pw: string) => Promise<string | null>;
  signUp: (email: string, pw: string) => Promise<SignUpResult>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<string | null>;
  updatePassword: (newPw: string) => Promise<string | null>;
  deleteAccount: () => Promise<string | null>;
}

export async function signIn(email: string, pw: string): Promise<string | null> {
  const client = getSupabase();
  if (!client) return 'Supabase not configured';
  const { error } = await client.auth.signInWithPassword({ email, password: pw });
  if (error) {
    log.warn(`signIn failed: ${error.message}`);
    return error.message;
  }
  log.info(`signed in: ${email}`);
  return null;
}

export async function signUp(email: string, pw: string): Promise<SignUpResult> {
  const client = getSupabase();
  if (!client) return { error: 'Supabase not configured', needsConfirmation: false };
  const { data, error } = await client.auth.signUp({ email, password: pw });
  if (error) {
    log.warn(`signUp failed: ${error.message}`);
    return { error: error.message, needsConfirmation: false };
  }
  if (!data.session) {
    log.info(`sign-up pending confirmation: ${email}`);
    return { error: null, needsConfirmation: true };
  }
  log.info(`signed up: ${email}`);
  return { error: null, needsConfirmation: false };
}

export async function signOut(): Promise<void> {
  const client = getSupabase();
  if (!client) return;
  const { error } = await client.auth.signOut();
  if (error) log.warn(`signOut failed: ${error.message}`);
  else log.info('signed out');
}

export async function resetPassword(email: string): Promise<string | null> {
  const client = getSupabase();
  if (!client) return 'Supabase not configured';
  const { error } = await client.auth.resetPasswordForEmail(email, {
    redirectTo: 'pulse://reset-password',
  });
  if (error) {
    log.warn(`resetPassword failed: ${error.message}`);
    return error.message;
  }
  log.info(`password reset email sent to ${email}`);
  return null;
}

export async function updatePassword(newPw: string): Promise<string | null> {
  const client = getSupabase();
  if (!client) return 'Supabase not configured';
  const { error } = await client.auth.updateUser({ password: newPw });
  if (error) {
    log.warn(`updatePassword failed: ${error.message}`);
    return error.message;
  }
  log.info('password updated successfully');
  useAppStore.getState().setIsPasswordRecovery(false);
  return null;
}

export async function deleteAccount(): Promise<string | null> {
  const client = getSupabase();
  if (!client) return 'Supabase not configured';
  log.info('requesting account deletion');
  const { error } = await client.rpc('delete_my_account');
  if (error) {
    log.warn(`deleteAccount failed: ${error.message}`);
    return error.message;
  }
  log.info('account deleted — wiping local data');
  await signOut();
  try {
    storage.clearAll();
  } catch (e) {
    log.warn(`storage.clearAll failed: ${String(e)}`);
  }
  return null;
}

export function handleAuthStateChange(event: string, session: Session | null): void {
  const { setSession, setAppState } = useAppStore.getState();
  setSession(session);
  if (event === 'SIGNED_IN') {
    const { appState } = useAppStore.getState();
    if (appState === 'unauthenticated') setAppState('prefs-loading');
  }
  if (event === 'SIGNED_OUT') {
    setAppState('unauthenticated');
    useAppStore.getState().setIsPasswordRecovery(false);
  }
  if (event === 'PASSWORD_RECOVERY') useAppStore.getState().setIsPasswordRecovery(true);
  if (event === 'TOKEN_REFRESHED') log.debug('access token refreshed silently');
}

export function useSupabaseAuth(): AuthActions {
  const supabase = getSupabase();

  useDeepLinkRecovery(supabase, () => useAppStore.getState().setIsPasswordRecovery(true));

  useEffect(() => {
    const { setAuthReady } = useAppStore.getState();
    if (!supabase) {
      setAuthReady(true);
      return;
    }

    supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        useAppStore.getState().setSession(session);
        setAuthReady(true);
        log.info(`session restored: ${session ? session.user.email : 'none'}`);
      })
      .catch((e: unknown) => {
        log.warn(`getSession failed: ${String(e)}`);
        setAuthReady(true);
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      log.info(`auth state: ${event}`);
      handleAuthStateChange(event, session);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  return { signIn, signUp, signOut, resetPassword, updatePassword, deleteAccount };
}
