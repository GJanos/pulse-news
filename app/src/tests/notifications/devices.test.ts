import { storage } from '../../storage/mmkv';
import { getSupabase } from '../../supabase/client';
import { TOKEN_KEY } from '../../notifications/keys';
import { upsertDevice, linkDeviceToUser, updateNotifyTime } from '../../notifications/devices';

jest.mock('../../supabase/client', () => ({ getSupabase: jest.fn() }));

const mockGetSupabase = getSupabase as jest.MockedFunction<typeof getSupabase>;

interface FakeClient {
  upsert: jest.Mock;
  update: jest.Mock;
  eq: jest.Mock;
}

function makeClient(): FakeClient & { from: jest.Mock } {
  const api: FakeClient = {
    upsert: jest.fn().mockResolvedValue({ error: null }),
    update: jest.fn(),
    eq: jest.fn().mockResolvedValue({ error: null }),
  };
  api.update.mockReturnValue({ eq: api.eq });
  const from = jest.fn().mockReturnValue(api);
  return Object.assign(api, { from });
}

beforeEach(() => {
  jest.clearAllMocks();
  storage.clearAll();
});

describe('upsertDevice', () => {
  it('writes id + fcm_token + updated_at with onConflict id', async () => {
    const client = makeClient();
    mockGetSupabase.mockReturnValue(client as never);
    await upsertDevice({ deviceId: 'dev-1', fcmToken: 'tok-1' });
    expect(client.from).toHaveBeenCalledWith('devices');
    const [payload, opts] = client.upsert.mock.calls[0];
    expect(payload).toMatchObject({ id: 'dev-1', fcm_token: 'tok-1' });
    expect(typeof payload.updated_at).toBe('string');
    expect(payload.notify_at).toBeUndefined();
    expect(opts).toEqual({ onConflict: 'id' });
  });

  it('includes notify_at only when provided', async () => {
    const client = makeClient();
    mockGetSupabase.mockReturnValue(client as never);
    await upsertDevice({ deviceId: 'dev-1', fcmToken: 'tok-1', notifyAt: '08:15' });
    expect(client.upsert.mock.calls[0][0].notify_at).toBe('08:15');
  });

  it('no-ops when Supabase is unconfigured', async () => {
    mockGetSupabase.mockReturnValue(null);
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
});

describe('updateNotifyTime', () => {
  it('skips when no FCM token is cached', async () => {
    const client = makeClient();
    mockGetSupabase.mockReturnValue(client as never);
    await updateNotifyTime('dev-1', '09:00');
    expect(client.from).not.toHaveBeenCalled();
  });

  it('upserts notify_at using the cached token when present', async () => {
    storage.set(TOKEN_KEY, 'tok-cached');
    const client = makeClient();
    mockGetSupabase.mockReturnValue(client as never);
    await updateNotifyTime('dev-1', '09:00');
    expect(client.upsert.mock.calls[0][0]).toMatchObject({
      id: 'dev-1',
      fcm_token: 'tok-cached',
      notify_at: '09:00',
    });
  });
});
