import { Readable } from 'stream';
import type { IncomingMessage, ServerResponse } from 'http';
import handler from '../../api/account';
import { buildClient } from '../notify';

// Mock the Supabase client factory so notify.ts's heavy imports (firebase/ws) never load.
jest.mock('../notify', () => ({ buildClient: jest.fn() }));
jest.mock('../config', () => ({ loadPulseConfig: jest.fn() }));
jest.mock('../logging', () => ({
  getLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

const mockBuildClient = buildClient as jest.MockedFunction<typeof buildClient>;

interface FakeDb {
  auth: { getUser: jest.Mock };
  rpc: jest.Mock;
  from: jest.Mock;
  upsert: jest.Mock;
}

function makeDb(
  opts: {
    user?: { id: string; email?: string } | null;
    getUserError?: { message: string } | null;
    rpcError?: { message: string } | null;
  } = {},
): FakeDb {
  const { user = { id: 'user-1', email: 'a@b.c' }, getUserError = null, rpcError = null } = opts;
  const upsert = jest.fn().mockResolvedValue({ error: null });
  return {
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user }, error: getUserError }) },
    rpc: jest.fn().mockResolvedValue({ error: rpcError }),
    from: jest.fn().mockReturnValue({ upsert }),
    upsert,
  };
}

function makeReq(
  method: string,
  headers: Record<string, string | undefined>,
  body?: unknown,
): IncomingMessage {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
  const req = Readable.from(chunks) as unknown as IncomingMessage;
  (req as unknown as { headers: Record<string, string | undefined> }).headers = headers;
  (req as unknown as { method: string }).method = method;
  return req;
}

interface FakeRes {
  statusCode: number;
  body: string;
  writeHead: jest.Mock;
  end: jest.Mock;
}

function makeRes(): FakeRes {
  const res: FakeRes = {
    statusCode: 0,
    body: '',
    writeHead: jest.fn((status: number) => {
      res.statusCode = status;
      return res;
    }),
    end: jest.fn((chunk?: string) => {
      if (typeof chunk === 'string') res.body = chunk;
      return res;
    }),
  };
  return res;
}

const AUTH = { authorization: 'Bearer valid-token' };

beforeEach(() => {
  jest.clearAllMocks();
});

describe('POST /api/account — handleRegister', () => {
  it('routes registration through the register_device RPC with p_user_id', async () => {
    const db = makeDb({ user: { id: 'user-1' } });
    mockBuildClient.mockReturnValue(db as never);

    const res = makeRes();
    await handler(
      makeReq('POST', AUTH, { deviceId: 'dev-1', fcmToken: 'fcm-1' }),
      res as unknown as ServerResponse,
    );

    expect(db.rpc).toHaveBeenCalledWith('register_device', {
      p_id: 'dev-1',
      p_token: 'fcm-1',
      p_user_id: 'user-1',
    });
    expect(res.statusCode).toBe(200);
  });

  it('does not fall back to a direct devices upsert', async () => {
    const db = makeDb();
    mockBuildClient.mockReturnValue(db as never);
    await handler(
      makeReq('POST', AUTH, { deviceId: 'dev-1', fcmToken: 'fcm-1' }),
      makeRes() as unknown as ServerResponse,
    );
    expect(db.from).not.toHaveBeenCalled();
  });

  it('never sends notify_at through the RPC (registration does not own it)', async () => {
    const db = makeDb();
    mockBuildClient.mockReturnValue(db as never);
    await handler(
      makeReq('POST', AUTH, { deviceId: 'dev-1', fcmToken: 'fcm-1', notifyAt: '08:00' }),
      makeRes() as unknown as ServerResponse,
    );
    const args = db.rpc.mock.calls[0]![1] as Record<string, unknown>;
    expect('notify_at' in args).toBe(false);
    expect('p_notify_at' in args).toBe(false);
  });

  it('returns 400 when deviceId or fcmToken is missing', async () => {
    const db = makeDb();
    mockBuildClient.mockReturnValue(db as never);
    const res = makeRes();
    await handler(makeReq('POST', AUTH, { deviceId: 'dev-1' }), res as unknown as ServerResponse);
    expect(res.statusCode).toBe(400);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('returns 500 when the RPC errors', async () => {
    const db = makeDb({ rpcError: { message: 'db down' } });
    mockBuildClient.mockReturnValue(db as never);
    const res = makeRes();
    await handler(
      makeReq('POST', AUTH, { deviceId: 'dev-1', fcmToken: 'fcm-1' }),
      res as unknown as ServerResponse,
    );
    expect(res.statusCode).toBe(500);
  });
});

describe('auth gate', () => {
  it('returns 401 when the Authorization header is missing', async () => {
    const db = makeDb();
    mockBuildClient.mockReturnValue(db as never);
    const res = makeRes();
    await handler(
      makeReq('POST', {}, { deviceId: 'd', fcmToken: 'f' }),
      res as unknown as ServerResponse,
    );
    expect(res.statusCode).toBe(401);
    expect(db.auth.getUser).not.toHaveBeenCalled();
  });

  it('returns 401 when token verification fails', async () => {
    const db = makeDb({ user: null, getUserError: { message: 'bad token' } });
    mockBuildClient.mockReturnValue(db as never);
    const res = makeRes();
    await handler(
      makeReq('POST', AUTH, { deviceId: 'd', fcmToken: 'f' }),
      res as unknown as ServerResponse,
    );
    expect(res.statusCode).toBe(401);
    expect(db.rpc).not.toHaveBeenCalled();
  });
});
