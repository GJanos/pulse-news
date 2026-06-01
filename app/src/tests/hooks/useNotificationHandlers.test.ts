import { renderHook, act } from '@testing-library/react-native';
import { useAppStore } from '../../store';
import { useNotificationHandlers } from '../../hooks/useNotificationHandlers';
import * as fcm from '../../notifications/fcm';

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
const mockFcm = fcm as jest.Mocked<typeof fcm>;

beforeEach(() => {
  jest.clearAllMocks();
  mockFcm.registerNotificationHandlers.mockReturnValue(jest.fn());
  useAppStore.setState({ appState: 'prefs-loading' });
});

it('does not register handlers before ready', () => {
  renderHook(() => useNotificationHandlers());
  expect(mockFcm.registerNotificationHandlers).not.toHaveBeenCalled();
});

it('registers handlers once ready and navigates to digest on tap', () => {
  useAppStore.setState({ appState: 'ready' });
  const navSpy = jest.spyOn(useAppStore.getState(), 'navigateToDigest');
  renderHook(() => useNotificationHandlers());
  expect(mockFcm.registerNotificationHandlers).toHaveBeenCalledTimes(1);
  const onDigest = mockFcm.registerNotificationHandlers.mock.calls[0]![0];
  onDigest();
  expect(navSpy).toHaveBeenCalled();
});

it('unsubscribes on unmount', () => {
  useAppStore.setState({ appState: 'ready' });
  const unsub = jest.fn();
  mockFcm.registerNotificationHandlers.mockReturnValue(unsub);
  const { unmount } = renderHook(() => useNotificationHandlers());
  unmount();
  expect(unsub).toHaveBeenCalled();
});

it('unsubscribes when leaving ready and re-registers on the next ready', () => {
  useAppStore.setState({ appState: 'ready' });
  const unsub = jest.fn();
  mockFcm.registerNotificationHandlers.mockReturnValue(unsub);
  const { rerender } = renderHook(() => useNotificationHandlers());
  expect(mockFcm.registerNotificationHandlers).toHaveBeenCalledTimes(1);

  act(() => useAppStore.setState({ appState: 'prefs-loading' }));
  rerender({});
  expect(unsub).toHaveBeenCalledTimes(1);

  act(() => useAppStore.setState({ appState: 'ready' }));
  rerender({});
  expect(mockFcm.registerNotificationHandlers).toHaveBeenCalledTimes(2);
});
