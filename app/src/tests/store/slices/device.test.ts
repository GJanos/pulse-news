import { createDeviceSlice, type DeviceSlice } from '../../../store/slices/device';

function makeSlice(): DeviceSlice {
  let state: DeviceSlice = {} as DeviceSlice;
  const set = jest.fn((partial: Partial<DeviceSlice>) => {
    state = { ...state, ...partial };
  });
  state = createDeviceSlice(
    set as unknown as Parameters<typeof createDeviceSlice>[0],
    () => state,
    {} as unknown as Parameters<typeof createDeviceSlice>[2],
  );
  // Create a proxy that always returns the latest state properties
  const slice = new Proxy({} as DeviceSlice, {
    get(target, prop: string | symbol) {
      if (prop === Symbol.toStringTag || prop === 'constructor') {
        return undefined;
      }
      return (state as unknown as Record<string, unknown>)[prop as string];
    },
  });
  return slice;
}

describe('DeviceSlice', () => {
  it('initialises with no identity and notifications disabled', () => {
    const slice = makeSlice();
    expect(slice.deviceId).toBeNull();
    expect(slice.fcmToken).toBeNull();
    expect(slice.notificationsEnabled).toBe(false);
  });

  it('setDeviceRegistration stores deviceId and fcmToken', () => {
    const slice = makeSlice();
    slice.setDeviceRegistration({ deviceId: 'dev-1', fcmToken: 'tok-1' });
    expect(slice.deviceId).toBe('dev-1');
    expect(slice.fcmToken).toBe('tok-1');
  });

  it('setNotificationsEnabled(true) enables notifications', () => {
    const slice = makeSlice();
    slice.setNotificationsEnabled(true);
    expect(slice.notificationsEnabled).toBe(true);
  });

  it('setNotificationsEnabled(false) after true restores false', () => {
    const slice = makeSlice();
    slice.setNotificationsEnabled(true);
    slice.setNotificationsEnabled(false);
    expect(slice.notificationsEnabled).toBe(false);
  });
});
