import { storage } from '../../storage/mmkv';
import { getSupabase } from '../../supabase/client';
import { TOKEN_KEY } from '../../notifications/keys';
import { upsertDevice, linkDeviceToUser, updateNotifyTime } from '../../notifications/devices';

jest.mock('../../supabase/client', () => ({ getSupabase: jest.fn() }));

const mockGetSupabase = getSupabase as jest.MockedFunction<typeof getSupabase>;

interface FakeClient {
  rpc: jest.Mock;
  from: jest.Mock;
}

// Every write now flows through client.rpc(name, args). `from` exists only so
// tests can assert it is NEVER called (no direct table access remains).
function makeClient(): FakeClient {
  return {
    rpc: jest.fn().mockResolvedValue({ data: true, error: null }),
    from: jest.fn(),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  storage.clearAll();
});

describe('upsertDevice', () => {
  it('registers via the register_device RPC with p_id + p_token', async () => {
    const client = makeClient();
    mockGetSupabase.mockReturnValue(client as never);
    await upsertDevice({ deviceId: 'dev-1', fcmToken: 'tok-1' });
    expect(client.rpc).toHaveBeenCalledWith('register_device', {
      p_id: 'dev-1',
      p_token: 'tok-1',
    });
    expect(client.from).not.toHaveBeenCalled();
  });

  it('omits p_user_id — login links the user separately', async () => {
    const client = makeClient();
    mockGetSupabase.mockReturnValue(client as never);
    await upsertDevice({ deviceId: 'dev-1', fcmToken: 'tok-1' });
    const args = client.rpc.mock.calls[0]![1] as Record<string, unknown>;
    expect('p_user_id' in args).toBe(false);
  });

  it('never writes notify_at — registration does not own it', async () => {
    const client = makeClient();
    mockGetSupabase.mockReturnValue(client as never);
    await upsertDevice({ deviceId: 'dev-1', fcmToken: 'tok-1' });
    const args = client.rpc.mock.calls[0]![1] as Record<string, unknown>;
    expect('notify_at' in args).toBe(false);
    expect('p_notify_at' in args).toBe(false);
  });

  it('returns false when Supabase is unconfigured', async () => {
    mockGetSupabase.mockReturnValue(null);
    await expect(upsertDevice({ deviceId: 'dev-1', fcmToken: 'tok-1' })).resolves.toBe(false);
  });

  it('returns false and does not throw when the RPC returns an error', async () => {
    const client = makeClient();
    client.rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    mockGetSupabase.mockReturnValue(client as never);
    await expect(upsertDevice({ deviceId: 'dev-1', fcmToken: 'tok-1' })).resolves.toBe(false);
  });
});

describe('linkDeviceToUser', () => {
  it('links via link_device_to_user with p_id and never touches the table', async () => {
    const client = makeClient();
    mockGetSupabase.mockReturnValue(client as never);
    await linkDeviceToUser('dev-1');
    expect(client.rpc).toHaveBeenCalledWith('link_device_to_user', { p_id: 'dev-1' });
    expect(client.from).not.toHaveBeenCalled();
  });

  it('does not pass a user_id — it is derived server-side from the JWT', async () => {
    const client = makeClient();
    mockGetSupabase.mockReturnValue(client as never);
    await linkDeviceToUser('dev-1');
    const args = client.rpc.mock.calls[0]![1] as Record<string, unknown>;
    expect('user_id' in args).toBe(false);
    expect('p_user_id' in args).toBe(false);
  });

  it('no-ops when Supabase is unconfigured', async () => {
    mockGetSupabase.mockReturnValue(null);
    await expect(linkDeviceToUser('dev-1')).resolves.toBeUndefined();
  });

  it('does not retry on a Supabase error — exits immediately', async () => {
    const client = makeClient();
    client.rpc.mockResolvedValue({ data: null, error: { message: 'denied' } });
    mockGetSupabase.mockReturnValue(client as never);
    await linkDeviceToUser('dev-1');
    expect(client.rpc).toHaveBeenCalledTimes(1);
  });

  it('succeeds on the first attempt when data is true', async () => {
    const client = makeClient();
    mockGetSupabase.mockReturnValue(client as never);
    await linkDeviceToUser('dev-1');
    expect(client.rpc).toHaveBeenCalledTimes(1);
  });

  it('retries on a false (0-row) result, succeeding on the last attempt', async () => {
    jest.useFakeTimers();
    const client = makeClient();
    client.rpc
      .mockResolvedValueOnce({ data: false, error: null })
      .mockResolvedValueOnce({ data: false, error: null })
      .mockResolvedValue({ data: true, error: null });
    mockGetSupabase.mockReturnValue(client as never);
    const promise = linkDeviceToUser('dev-1');
    await jest.advanceTimersByTimeAsync(2000);
    await jest.advanceTimersByTimeAsync(2000);
    await promise;
    expect(client.rpc).toHaveBeenCalledTimes(3);
    jest.useRealTimers();
  });

  it('stops after 3 attempts when the row never appears (always false)', async () => {
    jest.useFakeTimers();
    const client = makeClient();
    client.rpc.mockResolvedValue({ data: false, error: null });
    mockGetSupabase.mockReturnValue(client as never);
    const promise = linkDeviceToUser('dev-1');
    await jest.advanceTimersByTimeAsync(2000);
    await jest.advanceTimersByTimeAsync(2000);
    await promise;
    expect(client.rpc).toHaveBeenCalledTimes(3);
    jest.useRealTimers();
  });
});

describe('updateNotifyTime', () => {
  it('skips when no FCM token is cached (device not yet registered)', async () => {
    const client = makeClient();
    mockGetSupabase.mockReturnValue(client as never);
    await updateNotifyTime('dev-1', '09:00');
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('calls update_notify_time with p_id + p_notify_at and never touches the table', async () => {
    storage.set(TOKEN_KEY, 'tok-cached');
    const client = makeClient();
    mockGetSupabase.mockReturnValue(client as never);
    await updateNotifyTime('dev-1', '09:00');
    expect(client.rpc).toHaveBeenCalledWith('update_notify_time', {
      p_id: 'dev-1',
      p_notify_at: '09:00',
    });
    expect(client.from).not.toHaveBeenCalled();
  });

  it('forwards a null notify_at (clearing the time)', async () => {
    storage.set(TOKEN_KEY, 'tok-cached');
    const client = makeClient();
    mockGetSupabase.mockReturnValue(client as never);
    await updateNotifyTime('dev-1', null);
    const args = client.rpc.mock.calls[0]![1] as Record<string, unknown>;
    expect('p_notify_at' in args).toBe(true);
    expect(args.p_notify_at).toBeNull();
  });

  it('resolves when the RPC reports no row updated (data false)', async () => {
    storage.set(TOKEN_KEY, 'tok-cached');
    const client = makeClient();
    client.rpc.mockResolvedValue({ data: false, error: null });
    mockGetSupabase.mockReturnValue(client as never);
    await expect(updateNotifyTime('dev-1', '09:00')).resolves.toBeUndefined();
  });

  it('resolves without throwing when the RPC errors', async () => {
    storage.set(TOKEN_KEY, 'tok-cached');
    const client = makeClient();
    client.rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    mockGetSupabase.mockReturnValue(client as never);
    await expect(updateNotifyTime('dev-1', '09:00')).resolves.toBeUndefined();
  });
});
