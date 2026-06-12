const messagingMocks = {
  getMessaging: jest.fn(() => ({})),
  getToken: jest.fn(),
  requestPermission: jest.fn(),
  hasPermission: jest.fn(),
  onTokenRefresh: jest.fn((_fcm: unknown, _cb: unknown) => jest.fn()),
  onNotificationOpenedApp: jest.fn((_fcm: unknown, _cb: unknown) => jest.fn()),
  onMessage: jest.fn((_fcm: unknown, _cb: unknown) => jest.fn()),
  getInitialNotification: jest.fn().mockResolvedValue(null),
  AuthorizationStatus: { NOT_DETERMINED: 0, DENIED: 1, AUTHORIZED: 2, PROVISIONAL: 3 },
};
jest.mock('@react-native-firebase/messaging', () => messagingMocks);
jest.mock('expo-notifications', () => ({
  setBadgeCountAsync: jest.fn().mockResolvedValue(undefined),
  setNotificationChannelAsync: jest.fn().mockResolvedValue(undefined),
  AndroidImportance: { HIGH: 4 },
}));

import { Platform } from 'react-native';
import { setBadgeCountAsync, setNotificationChannelAsync } from 'expo-notifications';
import {
  requestPushPermission,
  getFcmToken,
  getNotificationPermission,
  onFcmTokenRefresh,
  registerNotificationHandlers,
  ensureDefaultChannel,
  DEFAULT_CHANNEL_ID,
} from '../../notifications/fcm';

const setPlatform = (os: 'android' | 'ios'): void => {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: os });
};

// Capture the real OS so each test's setPlatform() mutation can't leak into
// other suites sharing the react-native module (test order is not guaranteed).
const originalOS = Platform.OS;

beforeEach(() => jest.clearAllMocks());
afterEach(() => Object.defineProperty(Platform, 'OS', { configurable: true, value: originalOS }));

describe('ensureDefaultChannel', () => {
  it('creates a HIGH-importance "default" channel on Android', async () => {
    setPlatform('android');
    await ensureDefaultChannel();
    expect(setNotificationChannelAsync).toHaveBeenCalledTimes(1);
    const [id, channel] = (setNotificationChannelAsync as jest.Mock).mock.calls[0]!;
    expect(id).toBe(DEFAULT_CHANNEL_ID);
    expect(channel).toMatchObject({ importance: 4, enableVibrate: true });
  });

  it('omits the sound key so the channel gets the system default sound', async () => {
    // Any string here — even 'default' — is treated as a custom res/raw
    // filename and silently breaks the channel; null would mean silent.
    setPlatform('android');
    await ensureDefaultChannel();
    const [, channel] = (setNotificationChannelAsync as jest.Mock).mock.calls[0]!;
    expect('sound' in channel).toBe(false);
  });

  it('is a no-op off Android', async () => {
    setPlatform('ios');
    await ensureDefaultChannel();
    expect(setNotificationChannelAsync).not.toHaveBeenCalled();
  });

  it('swallows a setNotificationChannelAsync rejection without throwing', async () => {
    setPlatform('android');
    (setNotificationChannelAsync as jest.Mock).mockRejectedValueOnce(new Error('boom'));
    await expect(ensureDefaultChannel()).resolves.toBeUndefined();
  });
});

describe('permission + token', () => {
  it('requestPushPermission true for AUTHORIZED', async () => {
    messagingMocks.requestPermission.mockResolvedValue(2);
    expect(await requestPushPermission()).toBe(true);
  });

  it('requestPushPermission true for PROVISIONAL', async () => {
    messagingMocks.requestPermission.mockResolvedValue(3);
    expect(await requestPushPermission()).toBe(true);
  });

  it('requestPushPermission false for DENIED', async () => {
    messagingMocks.requestPermission.mockResolvedValue(1);
    expect(await requestPushPermission()).toBe(false);
  });

  it('requestPushPermission false for NOT_DETERMINED', async () => {
    messagingMocks.requestPermission.mockResolvedValue(0);
    expect(await requestPushPermission()).toBe(false);
  });

  it('requestPushPermission asks for a silent (no-sound) push grant', async () => {
    messagingMocks.requestPermission.mockResolvedValue(2);
    await requestPushPermission();
    const opts = messagingMocks.requestPermission.mock.calls[0]![1] as Record<string, unknown>;
    expect(opts).toMatchObject({ sound: false, badge: true, alert: true, provisional: false });
  });

  it('getFcmToken returns the token string', async () => {
    messagingMocks.getToken.mockResolvedValue('tok-abc');
    expect(await getFcmToken()).toBe('tok-abc');
  });

  it('getFcmToken returns null on empty token', async () => {
    messagingMocks.getToken.mockResolvedValue('');
    expect(await getFcmToken()).toBeNull();
  });

  it('getFcmToken returns null when getToken throws', async () => {
    messagingMocks.getToken.mockRejectedValue(new Error('boom'));
    expect(await getFcmToken()).toBeNull();
  });

  it('getNotificationPermission maps AUTHORIZED to true', async () => {
    messagingMocks.hasPermission.mockResolvedValue(2);
    expect(await getNotificationPermission()).toBe(true);
  });

  it('getNotificationPermission maps DENIED to false', async () => {
    messagingMocks.hasPermission.mockResolvedValue(1);
    expect(await getNotificationPermission()).toBe(false);
  });

  it('getNotificationPermission maps PROVISIONAL to true', async () => {
    messagingMocks.hasPermission.mockResolvedValue(3);
    expect(await getNotificationPermission()).toBe(true);
  });

  it('onFcmTokenRefresh wires the callback and returns the unsubscribe', () => {
    const unsub = jest.fn();
    messagingMocks.onTokenRefresh.mockReturnValue(unsub);
    const cb = jest.fn();
    const returned = onFcmTokenRefresh(cb);
    expect(messagingMocks.onTokenRefresh).toHaveBeenCalledWith(expect.anything(), cb);
    expect(returned).toBe(unsub);
  });
});

describe('registerNotificationHandlers', () => {
  it('fires onDailyDigest for a daily_digest background tap and clears the badge', () => {
    const onDigest = jest.fn();
    registerNotificationHandlers(onDigest);
    const cb = messagingMocks.onNotificationOpenedApp.mock.calls[0]![1] as (m: unknown) => void;
    cb({ data: { type: 'daily_digest' } });
    expect(onDigest).toHaveBeenCalledTimes(1);
    expect(setBadgeCountAsync).toHaveBeenCalledWith(0);
  });

  it('ignores non-digest messages', () => {
    const onDigest = jest.fn();
    registerNotificationHandlers(onDigest);
    const cb = messagingMocks.onMessage.mock.calls[0]![1] as (m: unknown) => void;
    cb({ data: { type: 'something_else' } });
    expect(onDigest).not.toHaveBeenCalled();
  });

  it('fires onDailyDigest for a foreground daily_digest message and clears the badge', () => {
    const onDigest = jest.fn();
    registerNotificationHandlers(onDigest);
    const cb = messagingMocks.onMessage.mock.calls[0]![1] as (m: unknown) => void;
    cb({ data: { type: 'daily_digest' } });
    expect(onDigest).toHaveBeenCalledTimes(1);
    expect(setBadgeCountAsync).toHaveBeenCalledWith(0);
  });

  it('does not crash or fire when the message has no data', () => {
    const onDigest = jest.fn();
    registerNotificationHandlers(onDigest);
    const cb = messagingMocks.onNotificationOpenedApp.mock.calls[0]![1] as (m: unknown) => void;
    expect(() => cb({})).not.toThrow();
    expect(onDigest).not.toHaveBeenCalled();
  });

  it('does not fire for a killed-app launch with no initial notification', async () => {
    messagingMocks.getInitialNotification.mockResolvedValue(null);
    const onDigest = jest.fn();
    registerNotificationHandlers(onDigest);
    await Promise.resolve();
    await Promise.resolve();
    expect(onDigest).not.toHaveBeenCalled();
  });

  it('swallows a getInitialNotification rejection without throwing', async () => {
    messagingMocks.getInitialNotification.mockRejectedValue(new Error('boom'));
    const onDigest = jest.fn();
    expect(() => registerNotificationHandlers(onDigest)).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    expect(onDigest).not.toHaveBeenCalled();
  });

  it('ignores a late initial notification after cleanup (cancelled guard)', async () => {
    let resolveInitial: (m: unknown) => void = () => {};
    messagingMocks.getInitialNotification.mockReturnValue(
      new Promise((res) => {
        resolveInitial = res;
      }),
    );
    const onDigest = jest.fn();
    const cleanup = registerNotificationHandlers(onDigest);
    cleanup();
    resolveInitial({ data: { type: 'daily_digest' } });
    await Promise.resolve();
    await Promise.resolve();
    expect(onDigest).not.toHaveBeenCalled();
  });

  it('fires onDailyDigest for a killed-app initial notification', async () => {
    messagingMocks.getInitialNotification.mockResolvedValue({ data: { type: 'daily_digest' } });
    const onDigest = jest.fn();
    registerNotificationHandlers(onDigest);
    await Promise.resolve();
    await Promise.resolve();
    expect(onDigest).toHaveBeenCalledTimes(1);
  });

  it('cleanup unsubscribes both live listeners', () => {
    const unsubBg = jest.fn();
    const unsubFg = jest.fn();
    messagingMocks.onNotificationOpenedApp.mockReturnValue(unsubBg);
    messagingMocks.onMessage.mockReturnValue(unsubFg);
    const cleanup = registerNotificationHandlers(jest.fn());
    cleanup();
    expect(unsubBg).toHaveBeenCalled();
    expect(unsubFg).toHaveBeenCalled();
  });
});
