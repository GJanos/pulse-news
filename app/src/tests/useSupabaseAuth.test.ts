import {
  signIn,
  signUp,
  resetPassword,
  updatePassword,
  deleteAccount,
  handleAuthStateChange,
} from '../hooks/useSupabaseAuth';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabase } from '../supabase/client';
import { storage } from '../storage/mmkv';
import { useAppStore } from '../store';

const mockSignInWithPassword = jest.fn();
const mockSignUp = jest.fn();
const mockSignOut = jest.fn();
const mockResetPasswordForEmail = jest.fn();
const mockUpdateUser = jest.fn();
const mockRpc = jest.fn();

const mockClient = {
  auth: {
    signInWithPassword: mockSignInWithPassword,
    signUp: mockSignUp,
    signOut: mockSignOut,
    resetPasswordForEmail: mockResetPasswordForEmail,
    updateUser: mockUpdateUser,
  },
  rpc: mockRpc,
};

jest.mock('../supabase/client', () => ({ getSupabase: jest.fn() }));
jest.mock('../storage/mmkv', () => ({ storage: { clearAll: jest.fn() } }));
jest.mock('../logger', () => ({
  getLogger: () => ({ info: jest.fn(), warn: jest.fn(), debug: jest.fn() }),
}));
jest.mock('../hooks/useDeepLinkRecovery', () => ({ useDeepLinkRecovery: jest.fn() }));

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getSupabase).mockReturnValue(mockClient as unknown as SupabaseClient);
  useAppStore.setState({ session: null, authReady: false, isPasswordRecovery: false });
});

describe('signIn', () => {
  it('returns null on success', async () => {
    mockSignInWithPassword.mockResolvedValue({ error: null });
    expect(await signIn('a@b.com', 'pass')).toBeNull();
  });

  it('returns error message on failure', async () => {
    mockSignInWithPassword.mockResolvedValue({ error: { message: 'Invalid credentials' } });
    expect(await signIn('a@b.com', 'wrong')).toBe('Invalid credentials');
  });

  it('returns configured error when supabase is null', async () => {
    jest.mocked(getSupabase).mockReturnValue(null);
    expect(await signIn('a@b.com', 'pass')).toBe('Supabase not configured');
  });
});

describe('signUp', () => {
  it('returns needsConfirmation when no session returned', async () => {
    mockSignUp.mockResolvedValue({ data: { session: null }, error: null });
    const result = await signUp('a@b.com', 'pass123');
    expect(result).toEqual({ error: null, needsConfirmation: true });
  });

  it('returns error on failure', async () => {
    mockSignUp.mockResolvedValue({
      data: { session: null },
      error: { message: 'Already registered' },
    });
    const result = await signUp('a@b.com', 'pass');
    expect(result).toEqual({ error: 'Already registered', needsConfirmation: false });
  });

  it('returns success with session', async () => {
    mockSignUp.mockResolvedValue({ data: { session: { user: {} } }, error: null });
    const result = await signUp('a@b.com', 'pass123');
    expect(result).toEqual({ error: null, needsConfirmation: false });
  });

  it('passes emailRedirectTo pulse://confirm', async () => {
    mockSignUp.mockResolvedValue({ data: { session: null }, error: null });
    await signUp('a@b.com', 'pass123');
    expect(mockSignUp).toHaveBeenCalledWith({
      email: 'a@b.com',
      password: 'pass123',
      options: { emailRedirectTo: 'pulse://confirm' },
    });
  });
});

describe('resetPassword', () => {
  it('returns null on success', async () => {
    mockResetPasswordForEmail.mockResolvedValue({ error: null });
    expect(await resetPassword('a@b.com')).toBeNull();
  });

  it('passes redirectTo pulse://reset-password', async () => {
    mockResetPasswordForEmail.mockResolvedValue({ error: null });
    await resetPassword('a@b.com');
    expect(mockResetPasswordForEmail).toHaveBeenCalledWith('a@b.com', {
      redirectTo: 'pulse://reset-password',
    });
  });

  it('returns error message on failure', async () => {
    mockResetPasswordForEmail.mockResolvedValue({ error: { message: 'Not found' } });
    expect(await resetPassword('a@b.com')).toBe('Not found');
  });
});

describe('updatePassword', () => {
  it('returns null and clears isPasswordRecovery on success', async () => {
    mockUpdateUser.mockResolvedValue({ error: null });
    useAppStore.setState({ isPasswordRecovery: true });
    expect(await updatePassword('newpass123')).toBeNull();
    expect(useAppStore.getState().isPasswordRecovery).toBe(false);
  });

  it('returns error and keeps isPasswordRecovery on failure', async () => {
    mockUpdateUser.mockResolvedValue({ error: { message: 'Weak password' } });
    useAppStore.setState({ isPasswordRecovery: true });
    expect(await updatePassword('weak')).toBe('Weak password');
    expect(useAppStore.getState().isPasswordRecovery).toBe(true);
  });
});

describe('handleAuthStateChange', () => {
  beforeEach(() => {
    useAppStore.setState({ appState: 'unauthenticated', session: null, isPasswordRecovery: false });
  });

  it('SIGNED_IN from unauthenticated → prefs-loading', () => {
    handleAuthStateChange('SIGNED_IN', null);
    expect(useAppStore.getState().appState).toBe('prefs-loading');
  });

  it('SIGNED_IN from ready stays at ready (token refresh guard)', () => {
    useAppStore.setState({ appState: 'ready' });
    handleAuthStateChange('SIGNED_IN', null);
    expect(useAppStore.getState().appState).toBe('ready');
  });

  it('SIGNED_OUT always transitions to unauthenticated', () => {
    useAppStore.setState({ appState: 'ready' });
    handleAuthStateChange('SIGNED_OUT', null);
    expect(useAppStore.getState().appState).toBe('unauthenticated');
  });

  it('PASSWORD_RECOVERY sets isPasswordRecovery', () => {
    handleAuthStateChange('PASSWORD_RECOVERY', null);
    expect(useAppStore.getState().isPasswordRecovery).toBe(true);
  });

  it('updates session on every event', () => {
    handleAuthStateChange('TOKEN_REFRESHED', null);
    expect(useAppStore.getState().session).toBeNull();
  });
});

describe('deleteAccount', () => {
  it('calls rpc, clears storage, signs out, returns null', async () => {
    mockRpc.mockResolvedValue({ error: null });
    mockSignOut.mockResolvedValue({ error: null });
    expect(await deleteAccount()).toBeNull();
    expect(mockRpc).toHaveBeenCalledWith('delete_my_account');
    expect(storage.clearAll).toHaveBeenCalled();
    expect(mockSignOut).toHaveBeenCalled();
  });

  it('returns error without wiping if rpc fails', async () => {
    mockRpc.mockResolvedValue({ error: { message: 'RPC failed' } });
    expect(await deleteAccount()).toBe('RPC failed');
    expect(storage.clearAll).not.toHaveBeenCalled();
  });
});
