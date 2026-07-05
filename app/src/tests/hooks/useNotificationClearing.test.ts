import { renderHook } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { useNotificationClearing } from '../../hooks/useNotificationClearing';
import * as fcm from '../../notifications/fcm';

// Factory mock so the real module's @react-native-firebase/messaging import
// (untranspiled ESM Jest can't parse) is never loaded.
jest.mock('../../notifications/fcm', () => ({ clearNotifications: jest.fn() }));
const mockFcm = fcm as jest.Mocked<typeof fcm>;

type AppStateHandler = (state: string) => void;
let handler: AppStateHandler | null;
const remove = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  handler = null;
  mockFcm.clearNotifications.mockResolvedValue(undefined);
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, fn) => {
    handler = fn as AppStateHandler;
    return { remove } as ReturnType<typeof AppState.addEventListener>;
  });
});

it('clears notifications once on mount (covers cold launch / launcher-icon open)', () => {
  renderHook(() => useNotificationClearing());
  expect(mockFcm.clearNotifications).toHaveBeenCalledTimes(1);
});

it('clears notifications again each time the app is foregrounded', () => {
  renderHook(() => useNotificationClearing());
  expect(mockFcm.clearNotifications).toHaveBeenCalledTimes(1);
  handler?.('active');
  expect(mockFcm.clearNotifications).toHaveBeenCalledTimes(2);
});

it('ignores AppState transitions other than active', () => {
  renderHook(() => useNotificationClearing());
  handler?.('background');
  handler?.('inactive');
  expect(mockFcm.clearNotifications).toHaveBeenCalledTimes(1); // mount only
});

it('removes the AppState listener on unmount', () => {
  const { unmount } = renderHook(() => useNotificationClearing());
  unmount();
  expect(remove).toHaveBeenCalled();
});
