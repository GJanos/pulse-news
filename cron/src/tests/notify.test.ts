import { persistDigests, persistGlobalDigest, dispatchFcm, sendNotifications } from '../notify';
import type { RegionDigest } from '../types';
import type { PulseConfig } from '@shared/config';

jest.mock('../logging', () => ({
  getLogger: () => ({ info: jest.fn(), warn: jest.fn(), debug: jest.fn() }),
}));

// ── Supabase mock ──────────────────────────────────────────────────────────────
// Models the fluent query builder: from().delete().lt() or from().upsert() etc.
const mockSupabase = {
  from: jest.fn().mockReturnThis(),
  delete: jest.fn().mockReturnThis(),
  lt: jest.fn().mockResolvedValue({ error: null }),
  upsert: jest.fn().mockResolvedValue({ error: null }),
  select: jest.fn().mockResolvedValue({ data: [], error: null }),
  in: jest.fn().mockResolvedValue({ error: null }),
};

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => mockSupabase),
}));

// ── Firebase Admin mock ────────────────────────────────────────────────────────
const mockSendEachForMulticast = jest.fn();
jest.mock('firebase-admin', () => ({
  __esModule: true,
  default: {
    apps: [],
    initializeApp: jest.fn(),
    credential: { cert: jest.fn() },
    messaging: jest.fn(() => ({ sendEachForMulticast: mockSendEachForMulticast })),
  },
}));

// ws has no runtime behaviour in tests — just needs to import without error.
jest.mock('ws', () => ({}));

// ── Helpers ────────────────────────────────────────────────────────────────────

const makeConfig = (evict = false): PulseConfig => ({
  model: {
    name: 'sonar-pro',
    reasoningEffort: 'low',
    temperature: 0.35,
    searchType: 'pro',
    searchContextSize: 'medium',
  },
  api: {
    regions: ['Hungary'],
    fetch: {
      count: 5,
      summarySentences: 1,
      detailSentences: 3,
      maxAttempts: 4,
      attemptDelay: 2000,
      retryDelay: 3000,
      minResults: 5,
      recencySequence: ['day'],
      buffer: 1,
    },
    ranking: {
      local: { enabled: true, model: 'claude-sonnet-4-6', maxTokens: 256 },
      global: {
        enabled: true,
        count: 5,
        model: 'claude-sonnet-4-6',
        maxTokens: 512,
        chunkSize: 25,
      },
    },
  },
  db: { evict, evictDays: 14 },
  log: { level: 'debug', qualityLog: true },
});

const makeDigests = (regions: string[]): RegionDigest[] =>
  regions.map((region) => ({
    region,
    headlines: [
      {
        title: `${region} headline`,
        summary: 'summary',
        url: 'https://example.com/1',
        imageUrl: 'https://img.example.com/1.jpg',
      },
    ],
    attempts: 1,
  }));

// ── persistDigests ─────────────────────────────────────────────────────────────

describe('persistDigests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset fluent chain returns
    mockSupabase.from.mockReturnThis();
    mockSupabase.delete.mockReturnThis();
    mockSupabase.lt.mockResolvedValue({ error: null });
    mockSupabase.upsert.mockResolvedValue({ error: null });
    // Provide env vars so buildClient() succeeds
    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SECRET_KEY = 'test-key';
  });

  it('upserts one row per digest into the digests table', async () => {
    const digests = makeDigests(['Hungary', 'United States']);
    await persistDigests(digests, makeConfig());

    expect(mockSupabase.from).toHaveBeenCalledWith('digests');
    expect(mockSupabase.upsert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ region: 'Hungary' }),
        expect.objectContaining({ region: 'United States' }),
      ]),
      { onConflict: 'region,date' },
    );
  });

  it("includes today's date and headlines payload in each row", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const digests = makeDigests(['Hungary']);
    await persistDigests(digests, makeConfig());

    const [rows] = mockSupabase.upsert.mock.calls[0] as [
      Array<{
        region: string;
        date: string;
        payload: { headlines: Array<{ imageUrl?: string }> };
      }>,
      unknown,
    ];
    expect(rows[0]!.date).toBe(today);
    expect(rows[0]!.payload.headlines).toHaveLength(1);
    // The matched og:image must travel into the persisted payload.
    expect(rows[0]!.payload.headlines[0]!.imageUrl).toBe('https://img.example.com/1.jpg');
  });

  it('throws when upsert returns an error', async () => {
    mockSupabase.upsert.mockResolvedValueOnce({ error: { message: 'db error' } });
    await expect(persistDigests(makeDigests(['Hungary']), makeConfig())).rejects.toThrow(
      'Digest upsert failed: db error',
    );
  });

  it('runs eviction delete when evict is enabled', async () => {
    await persistDigests(makeDigests(['Hungary']), makeConfig(true));
    expect(mockSupabase.delete).toHaveBeenCalled();
    expect(mockSupabase.lt).toHaveBeenCalledWith('date', expect.any(String));
  });

  it('skips eviction when evict is false', async () => {
    await persistDigests(makeDigests(['Hungary']), makeConfig(false));
    expect(mockSupabase.delete).not.toHaveBeenCalled();
  });
});

// ── persistGlobalDigest ────────────────────────────────────────────────────────

describe('persistGlobalDigest', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSupabase.from.mockReturnThis();
    mockSupabase.upsert.mockResolvedValue({ error: null });
    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SECRET_KEY = 'test-key';
  });

  it("upserts into global_digests with today's date and all headlines", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const headlines = [
      {
        title: 'Global story',
        summary: 'summary',
        url: 'https://example.com/1',
        region: 'Hungary',
      },
    ];

    await persistGlobalDigest(headlines);

    expect(mockSupabase.from).toHaveBeenCalledWith('global_digests');
    expect(mockSupabase.upsert).toHaveBeenCalledWith(
      { date: today, payload: { headlines } },
      { onConflict: 'date' },
    );
  });

  it('throws when upsert returns an error', async () => {
    mockSupabase.upsert.mockResolvedValueOnce({ error: { message: 'global db error' } });
    await expect(persistGlobalDigest([])).rejects.toThrow(
      'Global digest upsert failed: global db error',
    );
  });
});

// ── dispatchFcm ────────────────────────────────────────────────────────────────

describe('dispatchFcm', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSupabase.from.mockReturnThis();
    mockSupabase.in.mockResolvedValue({ error: null });
    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SECRET_KEY = 'test-key';
    process.env.FIREBASE_PROJECT_ID = 'test-project';
    process.env.FIREBASE_CLIENT_EMAIL = 'test@test.iam.gserviceaccount.com';
    process.env.FIREBASE_PRIVATE_KEY =
      '-----BEGIN PRIVATE KEY-----\\ntest\\n-----END PRIVATE KEY-----';
  });

  it('returns { sent: 0, total: 0 } immediately when tokens list is empty', async () => {
    const result = await dispatchFcm([]);
    expect(result).toEqual({ sent: 0, total: 0 });
    expect(mockSendEachForMulticast).not.toHaveBeenCalled();
  });

  it('deduplicates repeated tokens so one device is notified once', async () => {
    // A single physical device can own multiple `devices` rows (per-install UUID
    // regenerates across reinstalls while the FCM token survives), so the same
    // token arrives several times. Each token must be sent at most once.
    mockSendEachForMulticast.mockResolvedValueOnce({
      successCount: 2,
      responses: [{ error: null }, { error: null }, { error: null }],
    });

    const result = await dispatchFcm(['dup', 'dup', 'unique'], 'Hungary');

    expect(mockSendEachForMulticast).toHaveBeenCalledWith(
      expect.objectContaining({ tokens: ['dup', 'unique'] }),
    );
    expect(result).toEqual({ sent: 2, total: 2 });
  });

  it('calls sendEachForMulticast with tokens, notification body, and data', async () => {
    mockSendEachForMulticast.mockResolvedValueOnce({
      successCount: 2,
      responses: [{ error: null }, { error: null }],
    });

    const result = await dispatchFcm(['token-a', 'token-b'], 'Hungary,United States');

    expect(mockSendEachForMulticast).toHaveBeenCalledWith(
      expect.objectContaining({
        tokens: ['token-a', 'token-b'],
        notification: { title: 'Pulse', body: 'Your daily digest is ready' },
        data: { type: 'daily_digest', regions: 'Hungary,United States' },
        android: { priority: 'high', notification: { channelId: 'default' } },
      }),
    );
    expect(result).toEqual({ sent: 2, total: 2 });
  });

  it('does not include regions key in data when regions param is empty', async () => {
    mockSendEachForMulticast.mockResolvedValueOnce({
      successCount: 1,
      responses: [{ error: null }],
    });

    await dispatchFcm(['token-a']);

    const call = mockSendEachForMulticast.mock.calls[0]![0] as { data: Record<string, string> };
    expect(call.data).not.toHaveProperty('regions');
    expect(call.data['type']).toBe('daily_digest');
  });

  it('evicts stale tokens from DB after send', async () => {
    mockSendEachForMulticast.mockResolvedValueOnce({
      successCount: 1,
      responses: [
        { error: null },
        { error: { code: 'messaging/registration-token-not-registered' } },
      ],
    });

    await dispatchFcm(['token-good', 'token-stale']);

    expect(mockSupabase.from).toHaveBeenCalledWith('devices');
    expect(mockSupabase.in).toHaveBeenCalledWith('fcm_token', ['token-stale']);
  });

  it('evicts tokens with messaging/invalid-registration-token too', async () => {
    mockSendEachForMulticast.mockResolvedValueOnce({
      successCount: 1,
      responses: [{ error: { code: 'messaging/invalid-registration-token' } }, { error: null }],
    });

    await dispatchFcm(['token-invalid', 'token-good']);

    expect(mockSupabase.in).toHaveBeenCalledWith('fcm_token', ['token-invalid']);
  });

  it('skips DB eviction when no stale tokens', async () => {
    mockSendEachForMulticast.mockResolvedValueOnce({
      successCount: 2,
      responses: [{ error: null }, { error: null }],
    });

    await dispatchFcm(['token-a', 'token-b']);

    expect(mockSupabase.in).not.toHaveBeenCalled();
  });

  it('splits into multiple batches when tokens exceed FCM_BATCH_SIZE (500)', async () => {
    const tokens = Array.from({ length: 501 }, (_, i) => `token-${i}`);
    mockSendEachForMulticast
      .mockResolvedValueOnce({ successCount: 500, responses: Array(500).fill({ error: null }) })
      .mockResolvedValueOnce({ successCount: 1, responses: [{ error: null }] });

    const result = await dispatchFcm(tokens);

    expect(mockSendEachForMulticast).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ sent: 501, total: 501 });
  });
});

// ── sendNotifications ──────────────────────────────────────────────────────────

describe('sendNotifications', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSupabase.from.mockReturnThis();
    mockSupabase.in.mockResolvedValue({ error: null });
    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SECRET_KEY = 'test-key';
    process.env.FIREBASE_PROJECT_ID = 'test-project';
    process.env.FIREBASE_CLIENT_EMAIL = 'test@test.iam.gserviceaccount.com';
    process.env.FIREBASE_PRIVATE_KEY =
      '-----BEGIN PRIVATE KEY-----\\ntest\\n-----END PRIVATE KEY-----';
  });

  it('skips FCM dispatch when no devices are registered', async () => {
    mockSupabase.select.mockResolvedValueOnce({ data: [], error: null });

    await sendNotifications([{ region: 'Hungary', headlines: [], attempts: 1 }]);

    expect(mockSendEachForMulticast).not.toHaveBeenCalled();
  });

  it('dispatches FCM with tokens from all registered devices', async () => {
    mockSupabase.select.mockResolvedValueOnce({
      data: [
        { id: '1', fcm_token: 'tok-a' },
        { id: '2', fcm_token: 'tok-b' },
      ],
      error: null,
    });
    mockSendEachForMulticast.mockResolvedValueOnce({
      successCount: 2,
      responses: [{ error: null }, { error: null }],
    });

    await sendNotifications([
      { region: 'Hungary', headlines: [], attempts: 1 },
      { region: 'United States', headlines: [], attempts: 1 },
    ]);

    expect(mockSendEachForMulticast).toHaveBeenCalledWith(
      expect.objectContaining({
        tokens: ['tok-a', 'tok-b'],
        data: expect.objectContaining({ regions: 'Hungary,United States' }),
      }),
    );
  });

  it('throws when the device query returns an error', async () => {
    mockSupabase.select.mockResolvedValueOnce({ data: null, error: { message: 'query failed' } });

    await expect(
      sendNotifications([{ region: 'Hungary', headlines: [], attempts: 1 }]),
    ).rejects.toThrow('Failed to read device tokens: query failed');
  });
});
