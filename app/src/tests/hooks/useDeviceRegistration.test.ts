import { renderHook, waitFor, act } from '@testing-library/react-native';
import { AppState } from 'react-native';
import type { Session } from '@supabase/supabase-js';
import { useAppStore } from '../../store';
import { config } from '../../config';
import { useDeviceRegistration } from '../../hooks/useDeviceRegistration';
import * as register from '../../notifications/register';
import * as fcm from '../../notifications/fcm';
import * as devices from '../../notifications/devices';

// register/fcm are automocked below; building those automocks loads the real
// modules to introspect them, which touches the native boundary. Stub the
// native deps so introspection doesn't reach the real Firebase/Expo modules.
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
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => 'uuid') }));
jest.mock('../../notifications/register');
jest.mock('../../notifications/fcm');
jest.mock('../../notifications/devices');

const mockRegister = register as jest.Mocked<typeof register>;
const mockFcm = fcm as jest.Mocked<typeof fcm>;
const mockDevices = devices as jest.Mocked<typeof devices>;

beforeEach(() => {
  jest.clearAllMocks();
  useAppStore.setState({
    appState: 'prefs-loading',
    session: null,
    deviceId: null,
    notificationsEnabled: false,
    prefsHydrated: false,
    deviceReady: false,
  });
  mockRegister.registerForPushNotifications.mockResolvedValue({
    deviceId: 'dev-1',
    fcmToken: 'tok-1',
  });
  mockRegister.listenForTokenRefresh.mockReturnValue(jest.fn());
  mockFcm.getNotificationPermission.mockResolvedValue(true);
  mockDevices.linkDeviceToUser.mockResolvedValue(undefined);
  mockDevices.updateNotifyTime.mockResolvedValue(undefined);
});

it('writes registration + notificationsEnabled + deviceReady to the store', async () => {
  renderHook(() => useDeviceRegistration());
  await waitFor(() => expect(useAppStore.getState().deviceReady).toBe(true));
  expect(useAppStore.getState().deviceId).toBe('dev-1');
  expect(useAppStore.getState().notificationsEnabled).toBe(true);
});

it('still reflects OS permission when registration throws', async () => {
  mockRegister.registerForPushNotifications.mockRejectedValue(new Error('firebase boom'));
  mockFcm.getNotificationPermission.mockResolvedValue(true);
  renderHook(() => useDeviceRegistration());
  await waitFor(() => expect(useAppStore.getState().deviceReady).toBe(true));
  expect(useAppStore.getState().deviceId).toBeNull();
  expect(useAppStore.getState().notificationsEnabled).toBe(true);
});

it('sets deviceReady true even when registration returns null', async () => {
  mockRegister.registerForPushNotifications.mockResolvedValue(null);
  mockFcm.getNotificationPermission.mockResolvedValue(false);
  renderHook(() => useDeviceRegistration());
  await waitFor(() => expect(useAppStore.getState().deviceReady).toBe(true));
  expect(useAppStore.getState().deviceId).toBeNull();
  expect(useAppStore.getState().notificationsEnabled).toBe(false);
});

it('links the device to the user once a session and deviceId exist', async () => {
  renderHook(() => useDeviceRegistration());
  await waitFor(() => expect(useAppStore.getState().deviceId).toBe('dev-1'));
  useAppStore.setState({
    session: { user: { id: 'user-9' } } as unknown as Session,
  });
  await waitFor(() => expect(mockDevices.linkDeviceToUser).toHaveBeenCalledWith('dev-1', 'user-9'));
});

it('syncs notify_at once prefs are hydrated', async () => {
  renderHook(() => useDeviceRegistration());
  await waitFor(() => expect(useAppStore.getState().deviceId).toBe('dev-1'));
  useAppStore.setState({ prefsHydrated: true });
  await waitFor(() =>
    expect(mockDevices.updateNotifyTime).toHaveBeenCalledWith('dev-1', expect.any(String)),
  );
});

it('does not sync notify_at before prefs hydrate', async () => {
  renderHook(() => useDeviceRegistration());
  await waitFor(() => expect(useAppStore.getState().deviceId).toBe('dev-1'));
  expect(mockDevices.updateNotifyTime).not.toHaveBeenCalled();
});

it('does not link the device when there is no session', async () => {
  renderHook(() => useDeviceRegistration());
  await waitFor(() => expect(useAppStore.getState().deviceId).toBe('dev-1'));
  expect(mockDevices.linkDeviceToUser).not.toHaveBeenCalled();
});

it('sets deviceReady via the timeout guard when registration hangs', () => {
  jest.useFakeTimers();
  // Registration never resolves — only the timeout guard can flip deviceReady.
  mockRegister.registerForPushNotifications.mockReturnValue(new Promise<never>(() => {}));
  try {
    renderHook(() => useDeviceRegistration());
    expect(useAppStore.getState().deviceReady).toBe(false);
    act(() => {
      jest.advanceTimersByTime(config.deviceRegistrationTimeoutMs + 1);
    });
    expect(useAppStore.getState().deviceReady).toBe(true);
  } finally {
    jest.useRealTimers();
  }
});

it('re-checks notification permission when the app returns to foreground', async () => {
  renderHook(() => useDeviceRegistration());
  await waitFor(() => expect(useAppStore.getState().notificationsEnabled).toBe(true));
  const calls = (AppState.addEventListener as jest.Mock).mock.calls;
  const handler = calls[calls.length - 1]![1] as (s: string) => void;
  mockFcm.getNotificationPermission.mockResolvedValueOnce(false);
  act(() => handler('active'));
  await waitFor(() => expect(useAppStore.getState().notificationsEnabled).toBe(false));
});

it('ignores AppState changes other than active', async () => {
  renderHook(() => useDeviceRegistration());
  await waitFor(() => expect(useAppStore.getState().deviceReady).toBe(true));
  mockFcm.getNotificationPermission.mockClear();
  const calls = (AppState.addEventListener as jest.Mock).mock.calls;
  const handler = calls[calls.length - 1]![1] as (s: string) => void;
  act(() => handler('background'));
  expect(mockFcm.getNotificationPermission).not.toHaveBeenCalled();
});

it('removes the AppState listener and token-refresh sub on unmount', async () => {
  const remove = jest.fn();
  const unsub = jest.fn();
  (AppState.addEventListener as jest.Mock).mockReturnValueOnce({ remove });
  mockRegister.listenForTokenRefresh.mockReturnValue(unsub);
  const { unmount } = renderHook(() => useDeviceRegistration());
  await waitFor(() => expect(useAppStore.getState().deviceId).toBe('dev-1'));
  unmount();
  expect(remove).toHaveBeenCalled();
  expect(unsub).toHaveBeenCalled();
});
