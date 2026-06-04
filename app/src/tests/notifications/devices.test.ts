import { storage } from '../../storage/mmkv';
import { getSupabase } from '../../supabase/client';
import { TOKEN_KEY } from '../../notifications/keys';
import { upsertDevice, linkDeviceToUser, updateNotifyTime } from '../../notifications/devices';

jest.mock('../../supabase/client', () => ({ getSupabase: jest.fn() }));

const mockGetSupabase = getSupabase as jest.MockedFunction<typeof getSupabase>;

interface FakeClient {
  rpc: jest.Mock;
  upsert: jest.Mock;
  update: jest.Mock;
  eq: jest.Mock;
  select: jest.Mock;
}

function makeClient(): FakeClient & { from: jest.Mock } {
  const api: FakeClient = {
    rpc: jest.fn().mockResolvedValue({ error: null }),
    upsert: jest.fn().mockResolvedValue({ error: null }),
    update: jest.fn(),
    eq: jest.fn(),
    select: jest.fn().mockResolvedValue({ data: [{ id: 'dev-1' }], error: null }),
  };
  // update().eq() is awaited directly by updateNotifyTime (resolves to { error });
  // update().eq().select() is awaited by linkDeviceToUser (resolves to { data, error }).
  api.update.mockReturnValue({ eq: api.eq });
  api.eq.mockReturnValue(Object.assign(Promise.resolve({ error: null }), { select: api.select }));
  const from = jest.fn().mockReturnValue(api);
  return Object.assign(api, { from });
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
    // No direct table write — the RPC owns the upsert + reinstall-ghost eviction.
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

  it('no-ops when Supabase is unconfigured', async () => {
    mockGetSupabase.mockReturnValue(null);
    await expect(upsertDevice({ deviceId: 'dev-1', fcmToken: 'tok-1' })).resolves.toBeUndefined();
  });

  it('resolves without throwing when the RPC returns an error', async () => {
    const client = makeClient();
    client.rpc.mockResolvedValue({ error: { message: 'boom' } });
    mockGetSupabase.mockReturnValue(client as never);
    await expect(upsertDevice({ deviceId: 'dev-1', fcmToken: 'tok-1' })).resolves.toBeUndefined();
  });
});

describe('linkDeviceToUser', () => {
  it('updates user_id filtered by device id', async () => {
    const client = makeClient();
    mockGetSupabase.mockReturnValue(client as never);
    await linkDeviceToUser('dev-1', 'user-9');
    expect(client.update).toHaveBeenCalledWith({ user_id: 'user-9' });
    expect(client.eq).toHaveBeenCalledWith('id', 'dev-1');
  });

  it('no-ops when Supabase is unconfigured', async () => {
    mockGetSupabase.mockReturnValue(null);
    await expect(linkDeviceToUser('dev-1', 'user-9')).resolves.toBeUndefined();
  });

  it('resolves without throwing when the update errors', async () => {
    const client = makeClient();
    client.select.mockResolvedValue({ data: null, error: { message: 'denied' } });
    mockGetSupabase.mockReturnValue(client as never);
    await expect(linkDeviceToUser('dev-1', 'user-9')).resolves.toBeUndefined();
  });

  it('resolves without throwing when no device row matches (0 rows updated)', async () => {
    const client = makeClient();
    client.select.mockResolvedValue({ data: [], error: null });
    mockGetSupabase.mockReturnValue(client as never);
    await expect(linkDeviceToUser('dev-1', 'user-9')).resolves.toBeUndefined();
  });
});

describe('updateNotifyTime', () => {
  it('skips when no FCM token is cached (device not yet registered)', async () => {
    const client = makeClient();
    mockGetSupabase.mockReturnValue(client as never);
    await updateNotifyTime('dev-1', '09:00');
    expect(client.from).not.toHaveBeenCalled();
  });

  it('issues a direct notify_at update filtered by device id', async () => {
    storage.set(TOKEN_KEY, 'tok-cached');
    const client = makeClient();
    mockGetSupabase.mockReturnValue(client as never);
    await updateNotifyTime('dev-1', '09:00');
    expect(client.from).toHaveBeenCalledWith('devices');
    const payload = client.update.mock.calls[0]![0] as Record<string, unknown>;
    expect(payload.notify_at).toBe('09:00');
    expect(typeof payload.updated_at).toBe('string');
    expect(client.eq).toHaveBeenCalledWith('id', 'dev-1');
    // Not a registration: no token/id write, so no upsert and no RPC eviction.
    expect(client.upsert).not.toHaveBeenCalled();
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('forwards a null notify_at (clearing the time)', async () => {
    storage.set(TOKEN_KEY, 'tok-cached');
    const client = makeClient();
    mockGetSupabase.mockReturnValue(client as never);
    await updateNotifyTime('dev-1', null);
    const payload = client.update.mock.calls[0]![0] as Record<string, unknown>;
    expect('notify_at' in payload).toBe(true);
    expect(payload.notify_at).toBeNull();
  });

  it('selects the affected id to detect a 0-row update (row missing) and resolves', async () => {
    // A cached token means registration was *attempted*, not that the row exists — a prior
    // register_device RPC may have failed. The update must detect 0 rows, like linkDeviceToUser.
    storage.set(TOKEN_KEY, 'tok-cached');
    const client = makeClient();
    client.select.mockResolvedValue({ data: [], error: null });
    mockGetSupabase.mockReturnValue(client as never);
    await expect(updateNotifyTime('dev-1', '09:00')).resolves.toBeUndefined();
    expect(client.select).toHaveBeenCalledWith('id');
  });

  it('resolves without throwing when the update errors', async () => {
    storage.set(TOKEN_KEY, 'tok-cached');
    const client = makeClient();
    client.select.mockResolvedValue({ data: null, error: { message: 'boom' } });
    mockGetSupabase.mockReturnValue(client as never);
    await expect(updateNotifyTime('dev-1', '09:00')).resolves.toBeUndefined();
  });
});
