import { storage } from '../../storage/mmkv';
import { DEVICE_ID_KEY, TOKEN_KEY } from '../../notifications/keys';
import * as fcm from '../../notifications/fcm';
import * as devices from '../../notifications/devices';
import { registerForPushNotifications, listenForTokenRefresh } from '../../notifications/register';

// fcm is automocked below; loading the real module to build the automock
// executes its top-level getMessaging() — stub the native boundary so that
// introspection doesn't touch the real Firebase/expo-notifications modules.
jest.mock('@react-native-firebase/messaging', () => ({
  getMessaging: jest.fn(() => ({})),
  getToken: jest.fn(),
  requestPermission: jest.fn(),
  hasPermission: jest.fn(),
  onTokenRefresh: jest.fn(),
  onNotificationOpenedApp: jest.fn(),
  onMessage: jest.fn(),
  getInitialNotification: jest.fn(),
  AuthorizationStatus: { NOT_DETERMINED: 0, DENIED: 1, AUTHORIZED: 2, PROVISIONAL: 3 },
}));
jest.mock('expo-notifications', () => ({ setBadgeCountAsync: jest.fn() }));
jest.mock('../../notifications/fcm');
jest.mock('../../notifications/devices');
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => 'uuid-generated') }));

const mockFcm = fcm as jest.Mocked<typeof fcm>;
const mockDevices = devices as jest.Mocked<typeof devices>;

beforeEach(() => {
  jest.clearAllMocks();
  storage.clearAll();
  mockFcm.requestPushPermission.mockResolvedValue(true);
  mockFcm.getFcmToken.mockResolvedValue('tok-new');
  mockDevices.upsertDevice.mockResolvedValue(undefined);
});

describe('registerForPushNotifications', () => {
  it('generates and persists a device id on first run', async () => {
    const reg = await registerForPushNotifications();
    expect(reg).toEqual({ deviceId: 'uuid-generated', fcmToken: 'tok-new' });
    expect(storage.getString(DEVICE_ID_KEY)).toBe('uuid-generated');
  });

  it('reuses the persisted device id on later runs', async () => {
    storage.set(DEVICE_ID_KEY, 'uuid-existing');
    const reg = await registerForPushNotifications();
    expect(reg?.deviceId).toBe('uuid-existing');
  });

  it('upserts and caches the token when it changed', async () => {
    await registerForPushNotifications();
    expect(mockDevices.upsertDevice).toHaveBeenCalledWith({
      deviceId: 'uuid-generated',
      fcmToken: 'tok-new',
    });
    expect(storage.getString(TOKEN_KEY)).toBe('tok-new');
  });

  it('skips the upsert when the cached token is unchanged', async () => {
    storage.set(TOKEN_KEY, 'tok-new');
    await registerForPushNotifications();
    expect(mockDevices.upsertDevice).not.toHaveBeenCalled();
  });

  it('returns null when permission is denied', async () => {
    mockFcm.requestPushPermission.mockResolvedValue(false);
    expect(await registerForPushNotifications()).toBeNull();
    expect(mockFcm.getFcmToken).not.toHaveBeenCalled();
  });

  it('returns null when no token is available', async () => {
    mockFcm.getFcmToken.mockResolvedValue(null);
    expect(await registerForPushNotifications()).toBeNull();
    expect(mockDevices.upsertDevice).not.toHaveBeenCalled();
  });
});

describe('listenForTokenRefresh', () => {
  it('re-upserts and re-caches on rotation', async () => {
    let captured: ((t: string) => Promise<void>) | undefined;
    mockFcm.onFcmTokenRefresh.mockImplementation((cb) => {
      captured = cb as (t: string) => Promise<void>;
      return jest.fn();
    });
    listenForTokenRefresh('dev-1');
    await captured?.('tok-rotated');
    expect(mockDevices.upsertDevice).toHaveBeenCalledWith({
      deviceId: 'dev-1',
      fcmToken: 'tok-rotated',
    });
    expect(storage.getString(TOKEN_KEY)).toBe('tok-rotated');
  });
});
