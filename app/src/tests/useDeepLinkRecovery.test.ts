import type { SupabaseClient } from '@supabase/supabase-js';
import type * as ReactNS from 'react';
import { Linking } from 'react-native';
import { parseRecoveryPayload, useDeepLinkRecovery } from '../hooks/useDeepLinkRecovery';

// Typed access to the auto-mocked Linking methods
const mockGetInitialURL = Linking.getInitialURL as jest.Mock;
const mockAddEventListener = Linking.addEventListener as jest.Mock;

// We run hooks in a plain node environment (no renderer).
// Mock useEffect to execute immediately and useRef to return simple ref objects.
// The mock must be declared before any import that transitively uses 'react'.
let effectCallbacks: Array<() => (() => void) | void> = [];
const refs: Array<{ current: unknown }> = [];
let refCallCount = 0;

jest.mock('react', () => {
  const actual = jest.requireActual<typeof ReactNS>('react');
  return {
    ...actual,
    useEffect: (fn: () => (() => void) | void) => {
      effectCallbacks.push(fn);
    },
    useRef: (initial: unknown) => {
      if (refCallCount >= refs.length) {
        refs.push({ current: initial });
      }
      return refs[refCallCount++];
    },
  };
});

function resetHookState(): void {
  effectCallbacks = [];
  refs.length = 0;
  refCallCount = 0;
}

/**
 * Call useDeepLinkRecovery (captures effect + refs), then run the captured
 * effect synchronously. Returns the cleanup function if any.
 */
function runHook(supabase: SupabaseClient | null, onRecoveryStart: () => void): () => void {
  resetHookState();
  useDeepLinkRecovery(supabase, onRecoveryStart);
  let cleanup: () => void = () => undefined;
  for (const cb of effectCallbacks) {
    const result = cb();
    if (typeof result === 'function') cleanup = result;
  }
  return cleanup;
}

function makeSupabase() {
  return {
    auth: {
      exchangeCodeForSession: jest.fn().mockResolvedValue({ error: null }),
      setSession: jest.fn().mockResolvedValue({ error: null }),
    },
  } as unknown as SupabaseClient;
}

describe('parseRecoveryPayload', () => {
  it('returns null for non-recovery URL', () => {
    expect(parseRecoveryPayload('https://example.com/other')).toBeNull();
    expect(parseRecoveryPayload('pulse://home')).toBeNull();
  });

  it('extracts PKCE code from query string', () => {
    const result = parseRecoveryPayload('pulse://reset-password?code=abc123def');
    expect(result).toEqual({ type: 'pkce', code: 'abc123def', isRecovery: true });
  });

  it('decodes URL-encoded PKCE code', () => {
    const result = parseRecoveryPayload('pulse://reset-password?code=abc%3D%3D');
    expect(result).toEqual({ type: 'pkce', code: 'abc==', isRecovery: true });
  });

  it('extracts PKCE code from &-separated query string', () => {
    const result = parseRecoveryPayload('pulse://reset-password?foo=bar&code=xyz789');
    expect(result).toEqual({ type: 'pkce', code: 'xyz789', isRecovery: true });
  });

  it('extracts PKCE code from a confirm URL as non-recovery', () => {
    const result = parseRecoveryPayload('pulse://confirm?code=confirm123');
    expect(result).toEqual({ type: 'pkce', code: 'confirm123', isRecovery: false });
  });

  it('marks implicit confirm tokens as non-recovery', () => {
    const url = 'pulse://confirm#access_token=tok1&refresh_token=tok2&type=signup';
    const result = parseRecoveryPayload(url);
    expect(result).toEqual({
      type: 'implicit',
      accessToken: 'tok1',
      refreshToken: 'tok2',
      isRecovery: false,
    });
  });

  it('extracts implicit tokens from hash fragment', () => {
    const url = 'pulse://reset-password#access_token=tok1&refresh_token=tok2&type=recovery';
    const result = parseRecoveryPayload(url);
    expect(result).toEqual({
      type: 'implicit',
      accessToken: 'tok1',
      refreshToken: 'tok2',
      isRecovery: true,
    });
  });

  it('marks implicit as not recovery when type != recovery', () => {
    const url = 'pulse://reset-password#access_token=tok1&refresh_token=tok2&type=signup';
    const result = parseRecoveryPayload(url);
    expect(result).toEqual({
      type: 'implicit',
      accessToken: 'tok1',
      refreshToken: 'tok2',
      isRecovery: false,
    });
  });

  it('returns null for URL with access_token but no refresh_token', () => {
    const url = 'pulse://reset-password#access_token=tok1';
    expect(parseRecoveryPayload(url)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// useDeepLinkRecovery — hook-level tests
// ---------------------------------------------------------------------------

describe('useDeepLinkRecovery', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: no initial URL, addEventListener returns a removable sub
    mockGetInitialURL.mockResolvedValue(null);
    mockAddEventListener.mockReturnValue({ remove: jest.fn() });
  });

  it('is a no-op when supabase is null (no Linking calls)', () => {
    const onRecoveryStart = jest.fn();
    runHook(null, onRecoveryStart);

    expect(mockGetInitialURL).not.toHaveBeenCalled();
    expect(mockAddEventListener).not.toHaveBeenCalled();
    expect(onRecoveryStart).not.toHaveBeenCalled();
  });

  it('PKCE path: calls exchangeCodeForSession when initial URL has code param', async () => {
    const pkceUrl = 'pulse://reset-password?code=test-pkce-code';
    mockGetInitialURL.mockResolvedValue(pkceUrl);

    const supabase = makeSupabase();
    const onRecoveryStart = jest.fn();

    runHook(supabase, onRecoveryStart);
    // flush promises so the async loadInitialUrl completes
    await new Promise(setImmediate);

    expect(supabase.auth.exchangeCodeForSession).toHaveBeenCalledWith('test-pkce-code');
    expect(onRecoveryStart).toHaveBeenCalledTimes(1);
  });

  it('PKCE path: calls exchangeCodeForSession when URL arrives via addEventListener', async () => {
    const pkceUrl = 'pulse://reset-password?code=evt-code-456';

    const supabase = makeSupabase();
    const onRecoveryStart = jest.fn();

    let capturedHandler: ((event: { url: string }) => void) | null = null;
    mockAddEventListener.mockImplementation(
      (_event: string, handler: (event: { url: string }) => void) => {
        capturedHandler = handler;
        return { remove: jest.fn() };
      },
    );

    runHook(supabase, onRecoveryStart);
    await new Promise(setImmediate);

    expect(capturedHandler).not.toBeNull();
    capturedHandler!({ url: pkceUrl });
    await new Promise(setImmediate);

    expect(supabase.auth.exchangeCodeForSession).toHaveBeenCalledWith('evt-code-456');
    expect(onRecoveryStart).toHaveBeenCalledTimes(1);
  });

  it('confirm path: exchanges code but does NOT start recovery', async () => {
    const confirmUrl = 'pulse://confirm?code=confirm-pkce-code';
    mockGetInitialURL.mockResolvedValue(confirmUrl);

    const supabase = makeSupabase();
    const onRecoveryStart = jest.fn();

    runHook(supabase, onRecoveryStart);
    await new Promise(setImmediate);

    expect(supabase.auth.exchangeCodeForSession).toHaveBeenCalledWith('confirm-pkce-code');
    expect(onRecoveryStart).not.toHaveBeenCalled();
  });

  it('implicit path: calls setSession and onRecoveryStart when type=recovery', async () => {
    const implicitUrl = 'pulse://reset-password#access_token=at1&refresh_token=rt1&type=recovery';
    mockGetInitialURL.mockResolvedValue(implicitUrl);

    const supabase = makeSupabase();
    const onRecoveryStart = jest.fn();

    runHook(supabase, onRecoveryStart);
    await new Promise(setImmediate);

    expect(supabase.auth.setSession).toHaveBeenCalledWith({
      access_token: 'at1',
      refresh_token: 'rt1',
    });
    expect(onRecoveryStart).toHaveBeenCalledTimes(1);
  });

  it('duplicate URL dedup: same URL fired twice → handler called only once', async () => {
    const pkceUrl = 'pulse://reset-password?code=dedup-code';

    const supabase = makeSupabase();
    const onRecoveryStart = jest.fn();

    let capturedHandler: ((event: { url: string }) => void) | null = null;
    mockAddEventListener.mockImplementation(
      (_event: string, handler: (event: { url: string }) => void) => {
        capturedHandler = handler;
        return { remove: jest.fn() };
      },
    );

    runHook(supabase, onRecoveryStart);
    await new Promise(setImmediate);

    // Fire the same URL twice
    capturedHandler!({ url: pkceUrl });
    await new Promise(setImmediate);
    capturedHandler!({ url: pkceUrl });
    await new Promise(setImmediate);

    // exchangeCodeForSession and onRecoveryStart must each have been called exactly once
    expect(supabase.auth.exchangeCodeForSession).toHaveBeenCalledTimes(1);
    expect(onRecoveryStart).toHaveBeenCalledTimes(1);
  });

  it('removes the event listener on cleanup', async () => {
    const removeMock = jest.fn();
    mockAddEventListener.mockReturnValue({ remove: removeMock });

    const supabase = makeSupabase();
    const onRecoveryStart = jest.fn();

    const cleanup = runHook(supabase, onRecoveryStart);
    await new Promise(setImmediate);

    cleanup();
    expect(removeMock).toHaveBeenCalledTimes(1);
  });
});
